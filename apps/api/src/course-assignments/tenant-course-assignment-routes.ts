import type { FastifyPluginAsync } from "fastify";
import { eq, inArray } from "drizzle-orm";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requireAnyPermission, requirePermission } from "../permissions/require-permission";
import { courses } from "../db/schema/courses";
import { courseAssignments, type AssigneeType } from "../db/schema/course-assignments";
import { users } from "../db/schema/users";
import { departments } from "../db/schema/departments";
import { roles } from "../db/schema/roles";

interface AssignmentWriteBody {
  mode?: "all" | "selected";
  userIds?: unknown;
  departmentIds?: unknown;
  roleIds?: unknown;
}

function toIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((v): v is string => typeof v === "string" && v.length > 0)));
}

/** Course Assignment Settings — who a course is assigned to (Course Creation's Settings tab). All
 * routes operate through `request.tenantDb` (RLS-scoped) — no route ever takes or trusts a
 * client-supplied tenant id. */
const tenantCourseAssignmentRoutes: FastifyPluginAsync = async (fastify) => {
  /** Resolves a course's current assignment rows into the shape the Settings tab renders: a
   * `mode` plus the resolved (id + label) targets for whichever mode is `"selected"`. Zero rows —
   * every course created before this feature, and any course whose Settings tab has never been
   * saved — reads identically to an explicit `"all"` row (see the courses routes' matching
   * visibility query), so a never-configured course still shows "Everyone" rather than an empty,
   * seemingly-broken state. */
  async function getAssignmentResponse(tenantDb: typeof fastify.db, courseId: string) {
    const rows = await tenantDb.select().from(courseAssignments).where(eq(courseAssignments.courseId, courseId));

    const isAll = rows.length === 0 || rows.some((r) => r.assigneeType === "all");
    if (isAll) {
      return { mode: "all" as const, users: [], departments: [], roles: [] };
    }

    const userIds = rows.filter((r) => r.userId).map((r) => r.userId!);
    const departmentIds = rows.filter((r) => r.departmentId).map((r) => r.departmentId!);
    const roleIds = rows.filter((r) => r.roleId).map((r) => r.roleId!);

    const [userRows, departmentRows, roleRows] = await Promise.all([
      userIds.length > 0
        ? tenantDb.select({ id: users.id, fullName: users.fullName, email: users.email }).from(users).where(inArray(users.id, userIds))
        : Promise.resolve([]),
      departmentIds.length > 0
        ? tenantDb.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, departmentIds))
        : Promise.resolve([]),
      roleIds.length > 0
        ? tenantDb.select({ id: roles.id, name: roles.name }).from(roles).where(inArray(roles.id, roleIds))
        : Promise.resolve([]),
    ]);

    return { mode: "selected" as const, users: userRows, departments: departmentRows, roles: roleRows };
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

      const userIds = toIdArray(body.userIds);
      const departmentIds = toIdArray(body.departmentIds);
      const roleIds = toIdArray(body.roleIds);

      if (body.mode === "selected" && userIds.length === 0 && departmentIds.length === 0 && roleIds.length === 0) {
        return reply.code(422).send({
          success: false,
          message: "Select at least one user, department, or role, or choose Everyone.",
        });
      }

      if (body.mode === "selected") {
        const [foundUsers, foundDepartments, foundRoles] = await Promise.all([
          userIds.length > 0 ? request.tenantDb.select({ id: users.id }).from(users).where(inArray(users.id, userIds)) : Promise.resolve([]),
          departmentIds.length > 0
            ? request.tenantDb.select({ id: departments.id }).from(departments).where(inArray(departments.id, departmentIds))
            : Promise.resolve([]),
          roleIds.length > 0 ? request.tenantDb.select({ id: roles.id }).from(roles).where(inArray(roles.id, roleIds)) : Promise.resolve([]),
        ]);
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
          createdByUserId: request.user!.id,
        });
      } else {
        const rowsToInsert: { tenantId: string; courseId: string; assigneeType: AssigneeType; userId?: string; departmentId?: string; roleId?: string; createdByUserId: string }[] = [
          ...userIds.map((userId) => ({ tenantId: request.user!.tenantId, courseId, assigneeType: "user" as const, userId, createdByUserId: request.user!.id })),
          ...departmentIds.map((departmentId) => ({ tenantId: request.user!.tenantId, courseId, assigneeType: "department" as const, departmentId, createdByUserId: request.user!.id })),
          ...roleIds.map((roleId) => ({ tenantId: request.user!.tenantId, courseId, assigneeType: "role" as const, roleId, createdByUserId: request.user!.id })),
        ];
        await request.tenantDb.insert(courseAssignments).values(rowsToInsert);
      }

      const data = await getAssignmentResponse(request.tenantDb, courseId);
      return reply.code(200).send({ success: true, data });
    },
  );
};

export default tenantCourseAssignmentRoutes;
