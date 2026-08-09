import type { FastifyPluginAsync } from "fastify";
import { eq, inArray, sql } from "drizzle-orm";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requireAnyPermission, requirePermission } from "../permissions/require-permission";
import { courses } from "../db/schema/courses";
import { courseAssignments, type AssigneeType } from "../db/schema/course-assignments";
import { users } from "../db/schema/users";
import { departments } from "../db/schema/departments";
import { roles } from "../db/schema/roles";

function toIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((v): v is string => typeof v === "string" && v.length > 0)));
}

/** `YYYY-MM-DD` only — matches `<input type="date">`'s native value format exactly, so the frontend
 * never needs to parse or reformat it, and it round-trips through Postgres's `date` column (day-only,
 * no timezone) without ever passing through a JS `Date` object that could shift it by a day. */
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  // Rejects calendar-impossible dates (e.g. "2026-02-30") that `Date`'s constructor would otherwise
  // silently roll over into March instead of erroring.
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** `undefined`/`null` both mean "not set" (both date fields are nullable — an assignment doesn't
 * require either); any other value must be a valid `YYYY-MM-DD` string. Past dates are deliberately
 * allowed — nothing in this app's existing business rules restricts them (e.g. an admin
 * backfilling/correcting a date for a compliance record that already elapsed), so this stays
 * permissive rather than inventing a new restriction. Shared by both `startsAt` and
 * `completionDeadline` — same format, same validity rule, same "optional" semantics. */
function normalizeDateOnly(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value === "string" && isValidDateOnly(value)) return { ok: true, value };
  return { ok: false };
}

interface TargetInput {
  id?: unknown;
  startsAt?: unknown;
  completionDeadline?: unknown;
}

interface AssignmentWriteBody {
  mode?: "all" | "selected";
  /** Only meaningful when `mode === "all"`. */
  allStartsAt?: unknown;
  allCompletionDeadline?: unknown;
  users?: unknown;
  departments?: unknown;
  roles?: unknown;
}

interface NormalizedTarget {
  id: string;
  startsAt: string | null;
  completionDeadline: string | null;
}

/** Parses one of `body.users`/`body.departments`/`body.roles` — an array of
 * `{ id, startsAt?, completionDeadline? }` — deduping by `id` (last one wins, mirroring the old
 * plain-id-array's `Set`-based dedup) and validating both date fields. Returns `null` on any
 * malformed entry (missing/non-string `id`, or an invalid date) so the caller can reject the whole
 * request rather than silently drop bad rows. */
function parseTargets(value: unknown): NormalizedTarget[] | null {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, { startsAt: string | null; completionDeadline: string | null }>();
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return null;
    const { id, startsAt, completionDeadline } = entry as TargetInput;
    if (typeof id !== "string" || id.length === 0) return null;
    const normalizedStartsAt = normalizeDateOnly(startsAt);
    const normalizedCompletionDeadline = normalizeDateOnly(completionDeadline);
    if (!normalizedStartsAt.ok || !normalizedCompletionDeadline.ok) return null;
    byId.set(id, { startsAt: normalizedStartsAt.value, completionDeadline: normalizedCompletionDeadline.value });
  }
  return Array.from(byId.entries()).map(([id, dates]) => ({ id, ...dates }));
}

/** Course Assignment Settings — who a course is assigned to, and (Course Assignment Deadlines
 * follow-up) each target's own deadline. All routes operate through `request.tenantDb` (RLS-scoped)
 * — no route ever takes or trusts a client-supplied tenant id. */
const tenantCourseAssignmentRoutes: FastifyPluginAsync = async (fastify) => {
  /** Resolves a course's current assignment rows into the shape the Settings tab renders: a `mode`
   * plus the resolved (id + label + `startsAt` + `completionDeadline`) targets for whichever mode is
   * `"selected"`, or a single `allStartsAt`/`allCompletionDeadline` pair when `mode === "all"`. Zero
   * rows — every course created before this feature, and any course whose Settings tab has never been
   * saved — reads identically to an explicit `"all"` row (see the courses routes' matching visibility
   * query), so a never-configured course still shows "Everyone" (with no dates set) rather than an
   * empty, seemingly-broken state. */
  async function getAssignmentResponse(tenantDb: typeof fastify.db, courseId: string) {
    const rows = await tenantDb.select().from(courseAssignments).where(eq(courseAssignments.courseId, courseId));

    const allRow = rows.find((r) => r.assigneeType === "all");
    if (rows.length === 0 || allRow) {
      return {
        mode: "all" as const,
        allStartsAt: allRow?.startsAt ?? null,
        allCompletionDeadline: allRow?.completionDeadline ?? null,
        users: [],
        departments: [],
        roles: [],
      };
    }

    const userRowsById = new Map(rows.filter((r) => r.userId).map((r) => [r.userId!, r]));
    const departmentRowsById = new Map(rows.filter((r) => r.departmentId).map((r) => [r.departmentId!, r]));
    const roleRowsById = new Map(rows.filter((r) => r.roleId).map((r) => [r.roleId!, r]));

    // Sequential, not `Promise.all` — see the matching note in the PUT route below: `tenantDb` here
    // is one single pg `Client` for the whole request, so concurrent queries on it just queue
    // internally behind a deprecation warning rather than actually running in parallel.
    const userRows =
      userRowsById.size > 0
        ? await tenantDb.select({ id: users.id, fullName: users.fullName, email: users.email }).from(users).where(inArray(users.id, [...userRowsById.keys()]))
        : [];
    const departmentRows =
      departmentRowsById.size > 0
        ? await tenantDb.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, [...departmentRowsById.keys()]))
        : [];
    const roleRows =
      roleRowsById.size > 0
        ? await tenantDb.select({ id: roles.id, name: roles.name }).from(roles).where(inArray(roles.id, [...roleRowsById.keys()]))
        : [];

    return {
      mode: "selected" as const,
      allStartsAt: null,
      allCompletionDeadline: null,
      users: userRows.map((u) => ({ ...u, startsAt: userRowsById.get(u.id)!.startsAt, completionDeadline: userRowsById.get(u.id)!.completionDeadline })),
      departments: departmentRows.map((d) => ({
        ...d,
        startsAt: departmentRowsById.get(d.id)!.startsAt,
        completionDeadline: departmentRowsById.get(d.id)!.completionDeadline,
      })),
      roles: roleRows.map((r) => ({ ...r, startsAt: roleRowsById.get(r.id)!.startsAt, completionDeadline: roleRowsById.get(r.id)!.completionDeadline })),
    };
  }

  // GET /tenant/courses/:courseId/assignments
  fastify.get<{ Params: { courseId: string } }>(
    "/tenant/courses/:courseId/assignments",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("course.view", "course.manage")] },
    async (request, reply) => {
      const [existing] = await request.tenantDb.select({ id: courses.id }).from(courses).where(eq(courses.id, request.params.courseId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      const data = await getAssignmentResponse(request.tenantDb, request.params.courseId);
      return { success: true, data };
    },
  );

  // PUT /tenant/courses/:courseId/assignments — replace-all semantics, mirroring
  // `tenant-course-content-routes.ts`'s reorder endpoints: the whole target set is validated, then
  // the course's existing rows are deleted and the new set inserted, inside the same per-request
  // transaction `tenant-context.ts` already opens (atomic without a nested transaction).
  fastify.put<{ Params: { courseId: string }; Body: AssignmentWriteBody }>(
    "/tenant/courses/:courseId/assignments",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { courseId } = request.params;
      const [existing] = await request.tenantDb.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const body = request.body ?? {};
      if (body.mode !== "all" && body.mode !== "selected") {
        return reply.code(400).send({ success: false, message: "mode must be 'all' or 'selected'" });
      }

      const allStartsAt = normalizeDateOnly(body.allStartsAt);
      const allCompletionDeadline = normalizeDateOnly(body.allCompletionDeadline);
      if (!allStartsAt.ok || !allCompletionDeadline.ok) {
        return reply.code(400).send({ success: false, message: "allStartsAt/allCompletionDeadline must be a valid YYYY-MM-DD date or null" });
      }

      const userTargets = parseTargets(body.users);
      const departmentTargets = parseTargets(body.departments);
      const roleTargets = parseTargets(body.roles);
      if (userTargets === null || departmentTargets === null || roleTargets === null) {
        return reply.code(400).send({
          success: false,
          message: "Each user/department/role entry needs an id, and startsAt/completionDeadline must each be a valid YYYY-MM-DD date or null",
        });
      }

      if (body.mode === "selected" && userTargets.length === 0 && departmentTargets.length === 0 && roleTargets.length === 0) {
        return reply.code(422).send({
          success: false,
          message: "Select at least one user, department, or role, or choose Everyone.",
        });
      }

      if (body.mode === "selected") {
        const userIds = userTargets.map((t) => t.id);
        const departmentIds = departmentTargets.map((t) => t.id);
        const roleIds = roleTargets.map((t) => t.id);
        // Sequential, not `Promise.all` — `request.tenantDb` is bound to one single pg `Client` for
        // the whole request (tenant-context.ts), which can only run one query at a time; firing
        // several concurrently on it just makes node-postgres queue them internally behind a
        // deprecation warning (removed entirely in pg v9), not a real speedup.
        const foundUsers = userIds.length > 0 ? await request.tenantDb.select({ id: users.id }).from(users).where(inArray(users.id, userIds)) : [];
        const foundDepartments =
          departmentIds.length > 0
            ? await request.tenantDb.select({ id: departments.id }).from(departments).where(inArray(departments.id, departmentIds))
            : [];
        const foundRoles = roleIds.length > 0 ? await request.tenantDb.select({ id: roles.id }).from(roles).where(inArray(roles.id, roleIds)) : [];
        if (foundUsers.length !== userIds.length || foundDepartments.length !== departmentIds.length || foundRoles.length !== roleIds.length) {
          return reply.code(422).send({
            success: false,
            message: "One or more selected users, departments, or roles could not be found.",
          });
        }
      }

      await request.tenantDb.delete(courseAssignments).where(eq(courseAssignments.courseId, courseId));

      if (body.mode === "all") {
        await request.tenantDb.insert(courseAssignments).values({
          tenantId: request.user!.tenantId,
          courseId,
          assigneeType: "all",
          startsAt: allStartsAt.value,
          completionDeadline: allCompletionDeadline.value,
          createdByUserId: request.user!.id,
        });
      } else {
        const rowsToInsert: {
          tenantId: string;
          courseId: string;
          assigneeType: AssigneeType;
          userId?: string;
          departmentId?: string;
          roleId?: string;
          startsAt: string | null;
          completionDeadline: string | null;
          createdByUserId: string;
        }[] = [
          ...userTargets.map((t) => ({
            tenantId: request.user!.tenantId,
            courseId,
            assigneeType: "user" as const,
            userId: t.id,
            startsAt: t.startsAt,
            completionDeadline: t.completionDeadline,
            createdByUserId: request.user!.id,
          })),
          ...departmentTargets.map((t) => ({
            tenantId: request.user!.tenantId,
            courseId,
            assigneeType: "department" as const,
            departmentId: t.id,
            startsAt: t.startsAt,
            completionDeadline: t.completionDeadline,
            createdByUserId: request.user!.id,
          })),
          ...roleTargets.map((t) => ({
            tenantId: request.user!.tenantId,
            courseId,
            assigneeType: "role" as const,
            roleId: t.id,
            startsAt: t.startsAt,
            completionDeadline: t.completionDeadline,
            createdByUserId: request.user!.id,
          })),
        ];
        await request.tenantDb.insert(courseAssignments).values(rowsToInsert);
      }

      const data = await getAssignmentResponse(request.tenantDb, courseId);
      return reply.code(200).send({ success: true, data });
    },
  );

  // POST /tenant/course-assignments/audience-preview — Course Assignment audience builder (Course
  // Settings). Computes the *deduplicated* learner count for an in-progress, not-yet-saved selection
  // — a learner reachable through more than one source (individually selected AND in a selected
  // department, or in two selected departments at once) is counted exactly once, via a single
  // `count(*)` over `users` with OR'd match conditions rather than summing per-source counts.
  // Deliberately course-agnostic (pure department/role/user set arithmetic against the tenant's own
  // users, no `course_id` involved anywhere) — the same audience-size math applies to every course,
  // so this isn't nested under `/tenant/courses/:courseId`. Same permission as every other route in
  // this file: only `course.manage` can shape a course's audience, so only it can preview one.
  fastify.post<{ Body: { mode?: "all" | "selected"; userIds?: unknown; departmentIds?: unknown; roleIds?: unknown } }>(
    "/tenant/course-assignments/audience-preview",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const body = request.body ?? {};
      if (body.mode !== "all" && body.mode !== "selected") {
        return reply.code(400).send({ success: false, message: "mode must be 'all' or 'selected'" });
      }

      if (body.mode === "all") {
        const result = await request.tenantDb.execute(sql`SELECT count(*)::int AS "count" FROM users`);
        return { success: true, data: { totalLearners: (result.rows[0] as { count: number }).count } };
      }

      const userIds = toIdArray(body.userIds);
      const departmentIds = toIdArray(body.departmentIds);
      const roleIds = toIdArray(body.roleIds);
      if (userIds.length === 0 && departmentIds.length === 0 && roleIds.length === 0) {
        return { success: true, data: { totalLearners: 0 } };
      }

      const conditions = [
        userIds.length > 0 ? sql`u.id IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})` : sql`false`,
        departmentIds.length > 0 ? sql`u.department_id IN (${sql.join(departmentIds.map((id) => sql`${id}`), sql`, `)})` : sql`false`,
        roleIds.length > 0
          ? sql`EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id IN (${sql.join(roleIds.map((id) => sql`${id}`), sql`, `)}))`
          : sql`false`,
      ];

      const result = await request.tenantDb.execute(sql`
        SELECT count(*)::int AS "count" FROM users u WHERE ${sql.join(conditions, sql` OR `)}
      `);
      return { success: true, data: { totalLearners: (result.rows[0] as { count: number }).count } };
    },
  );
};

export default tenantCourseAssignmentRoutes;
