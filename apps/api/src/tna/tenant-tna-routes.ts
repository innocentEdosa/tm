import type { FastifyPluginAsync } from "fastify";
import { eq, asc, and, inArray, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requireAnyPermission } from "../permissions/require-permission";
import { tnaExercises, tnaExerciseTargets, TNA_TARGET_TYPES, type TnaTargetType } from "../db/schema/tna-exercises";
import { tnaAssignments } from "../db/schema/tna-assignments";
import { departments } from "../db/schema/departments";
import { roles, userRoles, rolePermissions } from "../db/schema/roles";
import { users } from "../db/schema/users";
import { tenants } from "../db/schema/tenants";
import { permissions } from "../db/schema/permissions";
import { departmentIsActive } from "../tenant-auth/team-write-validation";
import { resolveTnaParticipants } from "./resolve-tna-participants";
import { getFormFields } from "../custom-fields/field-key-uniqueness";
import { validateCustomFieldValues, writeCustomFieldValues } from "../custom-fields/save-values";
import { sendTnaAssignmentEmail } from "./tna-assignment-mailer";
import { TNA_RESPONSE_FORM_KEY, isExerciseOpenForSubmission, getTnaResponseValues } from "./tna-shared";
import { generateSessionToken, hashSessionToken } from "../platform-auth/session";
import type { Db } from "../db/client";

interface TargetInput {
  type: TnaTargetType;
  departmentId?: string;
  roleId?: string;
  userId?: string;
}

interface ExerciseWriteBody {
  title?: string;
  description?: string | null;
  endDate?: string;
  targetsAllDepartments?: boolean;
  targets?: TargetInput[];
}

function validateExerciseBody(body: ExerciseWriteBody, { partial }: { partial: boolean }): string | null {
  if (!partial || body.title !== undefined) {
    if (!body.title || !body.title.trim()) return "title is required";
  }
  if (!partial || body.endDate !== undefined) {
    if (!body.endDate || Number.isNaN(Date.parse(body.endDate))) return "endDate must be a valid date";
  }
  if (body.targets !== undefined) {
    for (const target of body.targets) {
      if (!TNA_TARGET_TYPES.includes(target.type)) return "each target must have a valid type";
      if (target.type === "department" && !target.departmentId) return "department targets require departmentId";
      if (target.type === "role" && !target.roleId) return "role targets require roleId";
      if (target.type === "user" && !target.userId) return "user targets require userId";
    }
  }
  return null;
}

const creator = alias(users, "tna_creator");
const committer = alias(users, "tna_committer");

function selectExerciseRow() {
  return {
    id: tnaExercises.id,
    title: tnaExercises.title,
    description: tnaExercises.description,
    endDate: tnaExercises.endDate,
    status: tnaExercises.status,
    targetsAllDepartments: tnaExercises.targetsAllDepartments,
    createdByUserId: tnaExercises.createdByUserId,
    createdByName: creator.fullName,
    startedAt: tnaExercises.startedAt,
    closedAt: tnaExercises.closedAt,
    reviewStartedAt: tnaExercises.reviewStartedAt,
    committedByUserId: tnaExercises.committedByUserId,
    committedByName: committer.fullName,
    committedAt: tnaExercises.committedAt,
    createdAt: tnaExercises.createdAt,
    updatedAt: tnaExercises.updatedAt,
  };
}

/** Confirms every referenced department/role/user actually exists (and, for departments, is
 * active) before any target rows are written — mirrors `training_needs`' own `departmentIsActive`
 * guard on write, just extended to the two additional target kinds this feature adds. */
async function validateTargets(tenantDb: Db, targets: TargetInput[]): Promise<string | null> {
  const departmentIds = targets.filter((t) => t.type === "department").map((t) => t.departmentId!);
  const roleIds = targets.filter((t) => t.type === "role").map((t) => t.roleId!);
  const userIds = targets.filter((t) => t.type === "user").map((t) => t.userId!);

  for (const departmentId of departmentIds) {
    if (!(await departmentIsActive(tenantDb, departmentId))) {
      return "One of the selected departments was not found or is not active";
    }
  }
  if (roleIds.length > 0) {
    const found = await tenantDb.select({ id: roles.id }).from(roles).where(inArray(roles.id, roleIds));
    if (found.length !== new Set(roleIds).size) return "One of the selected roles was not found";
  }
  if (userIds.length > 0) {
    const found = await tenantDb.select({ id: users.id }).from(users).where(inArray(users.id, userIds));
    if (found.length !== new Set(userIds).size) return "One of the selected users was not found";
  }
  return null;
}

async function replaceTargets(tenantDb: Db, tenantId: string, exerciseId: string, targets: TargetInput[]) {
  await tenantDb.delete(tnaExerciseTargets).where(eq(tnaExerciseTargets.tnaExerciseId, exerciseId));
  if (targets.length === 0) return;
  await tenantDb.insert(tnaExerciseTargets).values(
    targets.map((t) => ({
      tenantId,
      tnaExerciseId: exerciseId,
      targetType: t.type,
      departmentId: t.type === "department" ? t.departmentId! : null,
      roleId: t.type === "role" ? t.roleId! : null,
      userId: t.type === "user" ? t.userId! : null,
    })),
  );
}

/** Keeps `tna_assignments` in sync with the current targeting rules while an exercise is still a
 * draft, so the admin sees an accurate participant roster and count immediately after setting
 * targets — not only after clicking Start. Diffs against the existing roster (by `userId` +
 * `departmentId` context) rather than blindly delete-and-reinsert, so a participant whose targeting
 * didn't change keeps the same assignment `id` across repeated draft edits and the eventual Start
 * call — nothing outside this function should ever have to know an id was recycled. Safe to remove
 * rows that fell out of targeting because nothing can have responded yet (an exercise only accepts
 * submissions once it's active, see `isExerciseOpenForSubmission`). Tokens minted here for newly
 * added rows are never emailed — Start rotates every row's token right before actually sending the
 * magic-link email, so a token nobody received is never the one that ends up mattering. */
async function syncTnaAssignments(
  tenantDb: Db,
  tenantId: string,
  exerciseId: string,
  targetsAllDepartments: boolean,
): Promise<{ departmentsWithNoManager: string[] }> {
  const { participants, departmentsWithNoManager } = await resolveTnaParticipants(tenantDb, exerciseId, targetsAllDepartments);

  const existing = await tenantDb
    .select({ id: tnaAssignments.id, userId: tnaAssignments.userId, departmentId: tnaAssignments.departmentId })
    .from(tnaAssignments)
    .where(eq(tnaAssignments.tnaExerciseId, exerciseId));

  const keyOf = (userId: string, departmentId: string | null) => `${userId}::${departmentId ?? "GENERAL"}`;
  const existingKeys = new Set(existing.map((row) => keyOf(row.userId, row.departmentId)));
  const targetKeys = new Set(participants.map((p) => keyOf(p.userId, p.departmentId)));

  const staleIds = existing.filter((row) => !targetKeys.has(keyOf(row.userId, row.departmentId))).map((row) => row.id);
  if (staleIds.length > 0) {
    await tenantDb.delete(tnaAssignments).where(inArray(tnaAssignments.id, staleIds));
  }

  const toInsert = participants.filter((p) => !existingKeys.has(keyOf(p.userId, p.departmentId)));
  if (toInsert.length > 0) {
    await tenantDb.insert(tnaAssignments).values(
      toInsert.map((p) => ({
        tenantId,
        tnaExerciseId: exerciseId,
        userId: p.userId,
        departmentId: p.departmentId,
        sourceTargetType: p.sourceTargetType,
        magicLinkTokenHash: hashSessionToken(generateSessionToken()),
      })),
    );
  }

  return { departmentsWithNoManager };
}

/** Department-target names for the list view's "Department" column — an exercise with explicit
 * department targets shows their names; `targetsAllDepartments` is surfaced separately (the client
 * already has that boolean on the row) rather than resolved here into every active department's
 * name, which would defeat the point of the toggle. */
async function getTargetDepartmentNames(tenantDb: Db, exerciseId: string): Promise<string[]> {
  const rows = await tenantDb
    .select({ name: departments.name })
    .from(tnaExerciseTargets)
    .innerJoin(departments, eq(departments.id, tnaExerciseTargets.departmentId))
    .where(and(eq(tnaExerciseTargets.tnaExerciseId, exerciseId), eq(tnaExerciseTargets.targetType, "department")));
  return rows.map((r) => r.name);
}

async function getProgressCounts(tenantDb: Db, exerciseId: string) {
  const [row] = await tenantDb
    .select({
      assigned: sql<number>`count(*)::int`,
      submitted: sql<number>`count(*) filter (where ${tnaAssignments.status} = 'submitted')::int`,
    })
    .from(tnaAssignments)
    .where(eq(tnaAssignments.tnaExerciseId, exerciseId));
  const assigned = row?.assigned ?? 0;
  const submitted = row?.submitted ?? 0;
  return { assigned, submitted, pending: assigned - submitted, completionPercent: assigned > 0 ? Math.round((submitted / assigned) * 100) : 0 };
}

/** HR-initiated Training Needs Analysis exercises (Strategy nav) — deliberately separate from
 * Training Request (`training_needs` table/routes, `training_request.*` permissions): different
 * table namespace, different permission namespace (`tna.*`), different form key (`tna_response`
 * vs. Training Request's own `training_needs_analysis`), never reused. Gated by `tna.manage`/
 * `tna.view` for exercise authoring/reporting; a participant's own assignment is visible purely by
 * `tna_assignments.user_id` ownership, no permission required (mirrors "My Learning"'s own
 * assignment-based visibility). */
const tenantTnaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/tenant/tna-exercises",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("tna.manage", "tna.view")] },
    async (request) => {
      const rows = await request.tenantDb
        .select(selectExerciseRow())
        .from(tnaExercises)
        .leftJoin(creator, eq(creator.id, tnaExercises.createdByUserId))
        .leftJoin(committer, eq(committer.id, tnaExercises.committedByUserId))
        .orderBy(asc(tnaExercises.endDate));

      const withProgress = await Promise.all(
        rows.map(async (row) => ({
          ...row,
          progress: await getProgressCounts(request.tenantDb, row.id),
          departmentNames: await getTargetDepartmentNames(request.tenantDb, row.id),
        })),
      );
      return { success: true, data: withProgress };
    },
  );

  fastify.get<{ Params: { exerciseId: string } }>(
    "/tenant/tna-exercises/:exerciseId",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("tna.manage", "tna.view")] },
    async (request, reply) => {
      const { exerciseId } = request.params;
      const [row] = await request.tenantDb
        .select(selectExerciseRow())
        .from(tnaExercises)
        .leftJoin(creator, eq(creator.id, tnaExercises.createdByUserId))
        .leftJoin(committer, eq(committer.id, tnaExercises.committedByUserId))
        .where(eq(tnaExercises.id, exerciseId));
      if (!row) return reply.code(404).send({ success: false, message: "Not found" });

      const targets = await request.tenantDb
        .select({
          id: tnaExerciseTargets.id,
          targetType: tnaExerciseTargets.targetType,
          departmentId: tnaExerciseTargets.departmentId,
          departmentName: departments.name,
          roleId: tnaExerciseTargets.roleId,
          roleName: roles.name,
          userId: tnaExerciseTargets.userId,
          userName: users.fullName,
        })
        .from(tnaExerciseTargets)
        .leftJoin(departments, eq(departments.id, tnaExerciseTargets.departmentId))
        .leftJoin(roles, eq(roles.id, tnaExerciseTargets.roleId))
        .leftJoin(users, eq(users.id, tnaExerciseTargets.userId))
        .where(eq(tnaExerciseTargets.tnaExerciseId, exerciseId));

      const progress = await getProgressCounts(request.tenantDb, exerciseId);

      return { success: true, data: { ...row, targets, progress } };
    },
  );

  fastify.post<{ Body: ExerciseWriteBody }>(
    "/tenant/tna-exercises",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("tna.manage")] },
    async (request, reply) => {
      const body = request.body ?? {};
      const validationError = validateExerciseBody(body, { partial: false });
      if (validationError) return reply.code(400).send({ success: false, message: validationError });
      if (body.targets) {
        const targetError = await validateTargets(request.tenantDb, body.targets);
        if (targetError) return reply.code(422).send({ success: false, message: targetError });
      }

      const [created] = await request.tenantDb
        .insert(tnaExercises)
        .values({
          tenantId: request.user!.tenantId,
          title: body.title!.trim(),
          description: body.description?.trim() || null,
          endDate: body.endDate!,
          targetsAllDepartments: body.targetsAllDepartments ?? false,
          createdByUserId: request.user!.id,
        })
        .returning();

      if (body.targets) {
        await replaceTargets(request.tenantDb, request.user!.tenantId, created.id, body.targets);
      }

      const { departmentsWithNoManager } = await syncTnaAssignments(
        request.tenantDb,
        request.user!.tenantId,
        created.id,
        body.targetsAllDepartments ?? false,
      );

      return reply.code(201).send({ success: true, data: { id: created.id, departmentsWithNoManager } });
    },
  );

  fastify.patch<{ Params: { exerciseId: string }; Body: ExerciseWriteBody }>(
    "/tenant/tna-exercises/:exerciseId",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("tna.manage")] },
    async (request, reply) => {
      const { exerciseId } = request.params;
      const [existing] = await request.tenantDb.select().from(tnaExercises).where(eq(tnaExercises.id, exerciseId));
      if (!existing) return reply.code(404).send({ success: false, message: "Not found" });
      if (existing.status === "committed") {
        return reply.code(409).send({ success: false, message: "A committed exercise can no longer be edited." });
      }

      const body = request.body ?? {};
      const validationError = validateExerciseBody(body, { partial: true });
      if (validationError) return reply.code(400).send({ success: false, message: validationError });

      // Targeting rules are only editable pre-Start — assignments are a one-time snapshot
      // (resolve-tna-participants.ts), so changing targets afterward would silently do nothing to
      // the already-resolved roster, which would be confusing rather than useful.
      if ((body.targets !== undefined || body.targetsAllDepartments !== undefined) && existing.status !== "draft") {
        return reply.code(409).send({ success: false, message: "Targeting can only be changed while the exercise is still a draft." });
      }
      if (body.targets !== undefined) {
        const targetError = await validateTargets(request.tenantDb, body.targets);
        if (targetError) return reply.code(422).send({ success: false, message: targetError });
      }

      await request.tenantDb
        .update(tnaExercises)
        .set({
          ...(body.title !== undefined ? { title: body.title.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}),
          ...(body.endDate !== undefined ? { endDate: body.endDate } : {}),
          ...(body.targetsAllDepartments !== undefined ? { targetsAllDepartments: body.targetsAllDepartments } : {}),
          updatedAt: new Date(),
        })
        .where(eq(tnaExercises.id, exerciseId));

      if (body.targets !== undefined) {
        await replaceTargets(request.tenantDb, request.user!.tenantId, exerciseId, body.targets);
      }

      let departmentsWithNoManager: string[] = [];
      if (body.targets !== undefined || body.targetsAllDepartments !== undefined) {
        const effectiveTargetsAllDepartments = body.targetsAllDepartments ?? existing.targetsAllDepartments;
        ({ departmentsWithNoManager } = await syncTnaAssignments(
          request.tenantDb,
          request.user!.tenantId,
          exerciseId,
          effectiveTargetsAllDepartments,
        ));
      }

      return { success: true, data: { id: exerciseId, departmentsWithNoManager } };
    },
  );

  fastify.delete<{ Params: { exerciseId: string } }>(
    "/tenant/tna-exercises/:exerciseId",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("tna.manage")] },
    async (request, reply) => {
      const { exerciseId } = request.params;
      const [existing] = await request.tenantDb.select().from(tnaExercises).where(eq(tnaExercises.id, exerciseId));
      if (!existing) return reply.code(404).send({ success: false, message: "Not found" });
      if (existing.status !== "draft") {
        return reply.code(409).send({ success: false, message: "Only a draft exercise can be deleted." });
      }
      await request.tenantDb.delete(tnaExercises).where(eq(tnaExercises.id, exerciseId));
      return reply.code(204).send();
    },
  );

  // POST /tenant/tna-exercises/:exerciseId/start — flips status to 'active' and actually launches
  // the campaign. The roster itself (tna_assignments) was already resolved and kept in sync with
  // targeting rules at create/edit time (syncTnaAssignments), so Start's only remaining job is to
  // mint each assignment a fresh, real magic-link token (the draft-time tokens were never emailed to
  // anyone) and send the notification email — nothing was sent before this point, so it's safe to
  // rotate every token here right before first use.
  fastify.post<{ Params: { exerciseId: string } }>(
    "/tenant/tna-exercises/:exerciseId/start",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("tna.manage")] },
    async (request, reply) => {
      const { exerciseId } = request.params;
      const [existing] = await request.tenantDb.select().from(tnaExercises).where(eq(tnaExercises.id, exerciseId));
      if (!existing) return reply.code(404).send({ success: false, message: "Not found" });
      if (existing.status !== "draft") {
        return reply.code(409).send({ success: false, message: "Only a draft exercise can be started." });
      }

      // Re-sync once more immediately before launch in case a department's manager/assistant
      // manager changed after the roster was last previewed — and to get a fresh
      // departmentsWithNoManager warning to return alongside the launch result.
      const { departmentsWithNoManager } = await syncTnaAssignments(
        request.tenantDb,
        request.user!.tenantId,
        exerciseId,
        existing.targetsAllDepartments,
      );

      const assignmentRows = await request.tenantDb
        .select({ id: tnaAssignments.id, userId: tnaAssignments.userId })
        .from(tnaAssignments)
        .where(eq(tnaAssignments.tnaExerciseId, exerciseId));

      if (assignmentRows.length > 0) {
        const withTokens = [];
        for (const row of assignmentRows) {
          const token = generateSessionToken();
          await request.tenantDb
            .update(tnaAssignments)
            .set({ magicLinkTokenHash: hashSessionToken(token) })
            .where(eq(tnaAssignments.id, row.id));
          withTokens.push({ id: row.id, userId: row.userId, token });
        }
        void notifyTnaParticipants(request.tenantDb, request.user!.tenantId, existing.title, existing.endDate, withTokens);
      }

      await request.tenantDb
        .update(tnaExercises)
        .set({ status: "active", startedAt: new Date(), updatedAt: new Date() })
        .where(eq(tnaExercises.id, exerciseId));

      return {
        success: true,
        data: { id: exerciseId, participantsAssigned: assignmentRows.length, departmentsWithNoManager },
      };
    },
  );

  fastify.post<{ Params: { exerciseId: string } }>(
    "/tenant/tna-exercises/:exerciseId/close",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("tna.manage")] },
    async (request, reply) => {
      const { exerciseId } = request.params;
      const [existing] = await request.tenantDb.select().from(tnaExercises).where(eq(tnaExercises.id, exerciseId));
      if (!existing) return reply.code(404).send({ success: false, message: "Not found" });
      if (existing.status !== "active") {
        return reply.code(409).send({ success: false, message: "Only an active exercise can be closed." });
      }
      await request.tenantDb
        .update(tnaExercises)
        .set({ status: "closed", closedAt: new Date(), updatedAt: new Date() })
        .where(eq(tnaExercises.id, exerciseId));
      return { success: true, data: { id: exerciseId } };
    },
  );

  // POST /tenant/tna-exercises/:exerciseId/reopen — reverses an early/mistaken Close back to
  // 'active', clearing closedAt. Deliberately does not touch endDate — if the deadline has already
  // passed, HR must also extend it via PATCH (allowed in any non-committed status) for participants
  // to actually be able to submit again; reopening alone only restores the *status*.
  fastify.post<{ Params: { exerciseId: string } }>(
    "/tenant/tna-exercises/:exerciseId/reopen",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("tna.manage")] },
    async (request, reply) => {
      const { exerciseId } = request.params;
      const [existing] = await request.tenantDb.select().from(tnaExercises).where(eq(tnaExercises.id, exerciseId));
      if (!existing) return reply.code(404).send({ success: false, message: "Not found" });
      if (existing.status !== "closed") {
        return reply.code(409).send({ success: false, message: "Only a closed exercise can be reopened." });
      }
      await request.tenantDb
        .update(tnaExercises)
        .set({ status: "active", closedAt: null, updatedAt: new Date() })
        .where(eq(tnaExercises.id, exerciseId));
      return { success: true, data: { id: exerciseId } };
    },
  );

  fastify.post<{ Params: { exerciseId: string } }>(
    "/tenant/tna-exercises/:exerciseId/begin-review",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("tna.manage")] },
    async (request, reply) => {
      const { exerciseId } = request.params;
      const [existing] = await request.tenantDb.select().from(tnaExercises).where(eq(tnaExercises.id, exerciseId));
      if (!existing) return reply.code(404).send({ success: false, message: "Not found" });
      if (existing.status !== "closed") {
        return reply.code(409).send({ success: false, message: "Only a closed exercise can move to review." });
      }
      await request.tenantDb
        .update(tnaExercises)
        .set({ status: "under_review", reviewStartedAt: new Date(), updatedAt: new Date() })
        .where(eq(tnaExercises.id, exerciseId));
      return { success: true, data: { id: exerciseId } };
    },
  );

  // POST /tenant/tna-exercises/:exerciseId/commit — finalizes the exercise. If any assignment is
  // still 'pending', the first call is rejected with the pending count rather than silently
  // committing incomplete data; the caller must resend with `confirmDespitePending: true` to proceed
  // anyway (mirrors the confirm-then-retry shape already used for destructive actions elsewhere in
  // this app, e.g. delete-with-children).
  fastify.post<{ Params: { exerciseId: string }; Body: { confirmDespitePending?: boolean } }>(
    "/tenant/tna-exercises/:exerciseId/commit",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("tna.manage")] },
    async (request, reply) => {
      const { exerciseId } = request.params;
      const [existing] = await request.tenantDb.select().from(tnaExercises).where(eq(tnaExercises.id, exerciseId));
      if (!existing) return reply.code(404).send({ success: false, message: "Not found" });
      if (existing.status !== "under_review") {
        return reply.code(409).send({ success: false, message: "Only an exercise under review can be committed." });
      }
      const progress = await getProgressCounts(request.tenantDb, exerciseId);
      if (progress.pending > 0 && !request.body?.confirmDespitePending) {
        return reply.code(409).send({
          success: false,
          code: "PENDING_ASSIGNMENTS",
          message: `${progress.pending} of ${progress.assigned} assignment(s) are still pending. Commit anyway?`,
          pendingCount: progress.pending,
          assignedCount: progress.assigned,
        });
      }
      await request.tenantDb
        .update(tnaExercises)
        .set({
          status: "committed",
          committedByUserId: request.user!.id,
          committedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tnaExercises.id, exerciseId));
      return { success: true, data: { id: exerciseId } };
    },
  );

  // GET /tenant/tna-exercises/:exerciseId/assignments — admin roster + status for every resolved
  // participant.
  fastify.get<{ Params: { exerciseId: string } }>(
    "/tenant/tna-exercises/:exerciseId/assignments",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("tna.manage", "tna.view")] },
    async (request) => {
      const { exerciseId } = request.params;
      const rows = await request.tenantDb
        .select({
          id: tnaAssignments.id,
          userId: tnaAssignments.userId,
          userName: users.fullName,
          userEmail: users.email,
          departmentId: tnaAssignments.departmentId,
          departmentName: departments.name,
          sourceTargetType: tnaAssignments.sourceTargetType,
          status: tnaAssignments.status,
          submittedAt: tnaAssignments.submittedAt,
        })
        .from(tnaAssignments)
        .leftJoin(users, eq(users.id, tnaAssignments.userId))
        .leftJoin(departments, eq(departments.id, tnaAssignments.departmentId))
        .where(eq(tnaAssignments.tnaExerciseId, exerciseId))
        .orderBy(asc(users.fullName));
      return { success: true, data: rows };
    },
  );

  // GET /tenant/tna-exercises/:exerciseId/assignments/:assignmentId — admin drill-in to one
  // response, including its custom field values (the answers).
  fastify.get<{ Params: { exerciseId: string; assignmentId: string } }>(
    "/tenant/tna-exercises/:exerciseId/assignments/:assignmentId",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("tna.manage", "tna.view")] },
    async (request, reply) => {
      const { assignmentId } = request.params;
      const [row] = await request.tenantDb
        .select({
          id: tnaAssignments.id,
          userId: tnaAssignments.userId,
          userName: users.fullName,
          userEmail: users.email,
          departmentId: tnaAssignments.departmentId,
          departmentName: departments.name,
          status: tnaAssignments.status,
          submittedAt: tnaAssignments.submittedAt,
        })
        .from(tnaAssignments)
        .leftJoin(users, eq(users.id, tnaAssignments.userId))
        .leftJoin(departments, eq(departments.id, tnaAssignments.departmentId))
        .where(eq(tnaAssignments.id, assignmentId));
      if (!row) return reply.code(404).send({ success: false, message: "Not found" });

      const values = await getTnaResponseValues(request.tenantDb, assignmentId);
      return { success: true, data: { ...row, responseValues: values } };
    },
  );

  // POST /tenant/tna-exercises/:exerciseId/assignments — mid-campaign remediation: manually add one
  // participant to an already-started exercise (e.g. a department's manager changed after Start, or
  // someone was missed by the original targeting). Only meaningful once a roster exists (active,
  // closed, or under_review) and before the exercise is committed. Does not touch
  // `tna_exercise_targets` — this is a one-off roster addition, not a targeting-rule change.
  fastify.post<{ Params: { exerciseId: string }; Body: { userId?: string; departmentId?: string | null } }>(
    "/tenant/tna-exercises/:exerciseId/assignments",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("tna.manage")] },
    async (request, reply) => {
      const { exerciseId } = request.params;
      const [existing] = await request.tenantDb.select().from(tnaExercises).where(eq(tnaExercises.id, exerciseId));
      if (!existing) return reply.code(404).send({ success: false, message: "Not found" });
      if (!["active", "closed", "under_review"].includes(existing.status)) {
        return reply.code(409).send({
          success: false,
          message: "A participant can only be added once the exercise has started and before it is committed.",
        });
      }

      const userId = request.body?.userId;
      if (!userId) return reply.code(400).send({ success: false, message: "userId is required" });
      const departmentId = request.body?.departmentId || null;

      const [user] = await request.tenantDb
        .select({ id: users.id, archivedAt: users.archivedAt })
        .from(users)
        .where(eq(users.id, userId));
      if (!user) return reply.code(422).send({ success: false, message: "User not found" });
      if (user.archivedAt) return reply.code(422).send({ success: false, message: "This user has been deactivated and cannot be assigned." });

      if (departmentId && !(await departmentIsActive(request.tenantDb, departmentId))) {
        return reply.code(422).send({ success: false, message: "Department not found or is not active" });
      }

      const [existingAssignment] = await request.tenantDb
        .select({ id: tnaAssignments.id })
        .from(tnaAssignments)
        .where(
          and(
            eq(tnaAssignments.tnaExerciseId, exerciseId),
            eq(tnaAssignments.userId, userId),
            departmentId ? eq(tnaAssignments.departmentId, departmentId) : isNull(tnaAssignments.departmentId),
          ),
        );
      if (existingAssignment) {
        return reply.code(409).send({ success: false, message: "This person is already assigned to this exercise." });
      }

      const token = generateSessionToken();
      const [created] = await request.tenantDb
        .insert(tnaAssignments)
        .values({
          tenantId: request.user!.tenantId,
          tnaExerciseId: exerciseId,
          userId,
          departmentId,
          sourceTargetType: "user",
          magicLinkTokenHash: hashSessionToken(token),
        })
        .returning();

      void notifyTnaParticipants(request.tenantDb, request.user!.tenantId, existing.title, existing.endDate, [
        { id: created.id, userId: created.userId, token },
      ]);

      return reply.code(201).send({ success: true, data: { id: created.id } });
    },
  );

  // DELETE /tenant/tna-assignments/:assignmentId — mid-campaign remediation: remove a participant who
  // should no longer be part of the roster (e.g. added in error, or no longer eligible). Only a
  // still-'pending' assignment may be removed — a submitted response is retained data, not an
  // undoable roster entry, and must not be deletable this way.
  fastify.delete<{ Params: { assignmentId: string } }>(
    "/tenant/tna-assignments/:assignmentId",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("tna.manage")] },
    async (request, reply) => {
      const { assignmentId } = request.params;
      const [assignment] = await request.tenantDb
        .select({ id: tnaAssignments.id, status: tnaAssignments.status, exerciseStatus: tnaExercises.status })
        .from(tnaAssignments)
        .innerJoin(tnaExercises, eq(tnaExercises.id, tnaAssignments.tnaExerciseId))
        .where(eq(tnaAssignments.id, assignmentId));
      if (!assignment) return reply.code(404).send({ success: false, message: "Not found" });
      if (assignment.exerciseStatus === "committed") {
        return reply.code(409).send({ success: false, message: "A committed exercise's roster can no longer be changed." });
      }
      if (assignment.status !== "pending") {
        return reply.code(409).send({ success: false, message: "A submitted response cannot be removed from the roster." });
      }
      await request.tenantDb.delete(tnaAssignments).where(eq(tnaAssignments.id, assignmentId));
      return reply.code(204).send();
    },
  );

  // GET /tenant/my-tna-assignments — a participant's own assignments across every exercise, no
  // tna.* permission required (assignment ownership is the access rule). Excludes assignments whose
  // exercise is still 'draft': the roster is now resolved and kept in sync as soon as HR sets
  // targets (syncTnaAssignments, tenant-tna-routes.ts create/edit handlers), but a participant must
  // not see or be able to open a TNA until HR has actually clicked Start — draft is a preview state
  // for the admin only.
  fastify.get(
    "/tenant/my-tna-assignments",
    { preHandler: [requireTenantUserSession()] },
    async (request) => {
      const rows = await request.tenantDb
        .select({
          id: tnaAssignments.id,
          status: tnaAssignments.status,
          submittedAt: tnaAssignments.submittedAt,
          departmentId: tnaAssignments.departmentId,
          departmentName: departments.name,
          exerciseId: tnaExercises.id,
          exerciseTitle: tnaExercises.title,
          exerciseDescription: tnaExercises.description,
          exerciseStatus: tnaExercises.status,
          endDate: tnaExercises.endDate,
        })
        .from(tnaAssignments)
        .innerJoin(tnaExercises, eq(tnaExercises.id, tnaAssignments.tnaExerciseId))
        .leftJoin(departments, eq(departments.id, tnaAssignments.departmentId))
        .where(and(eq(tnaAssignments.userId, request.user!.id), ne(tnaExercises.status, "draft")))
        .orderBy(asc(tnaExercises.endDate));
      return { success: true, data: rows };
    },
  );

  // GET /tenant/tna-assignments/:assignmentId — a participant's own assignment detail (or an
  // admin's, for the same drill-in view participants get). Ownership-or-permission gate, not a
  // permission-only gate.
  fastify.get<{ Params: { assignmentId: string } }>(
    "/tenant/tna-assignments/:assignmentId",
    { preHandler: [requireTenantUserSession()] },
    async (request, reply) => {
      const { assignmentId } = request.params;
      const [row] = await request.tenantDb
        .select({
          id: tnaAssignments.id,
          userId: tnaAssignments.userId,
          departmentId: tnaAssignments.departmentId,
          departmentName: departments.name,
          status: tnaAssignments.status,
          submittedAt: tnaAssignments.submittedAt,
          exerciseId: tnaExercises.id,
          exerciseTitle: tnaExercises.title,
          exerciseDescription: tnaExercises.description,
          exerciseStatus: tnaExercises.status,
          endDate: tnaExercises.endDate,
        })
        .from(tnaAssignments)
        .innerJoin(tnaExercises, eq(tnaExercises.id, tnaAssignments.tnaExerciseId))
        .leftJoin(departments, eq(departments.id, tnaAssignments.departmentId))
        .where(eq(tnaAssignments.id, assignmentId));
      if (!row) return reply.code(404).send({ success: false, message: "Not found" });

      const isOwner = row.userId === request.user!.id;
      const isAdmin = await hasAnyTnaAdminPermission(request.tenantDb, request.user!.id);
      if (!isOwner && !isAdmin) return reply.code(404).send({ success: false, message: "Not found" });
      // A participant (non-admin) may not view their own assignment until HR has started the
      // exercise — draft is an admin-only preview state, mirrors the my-tna-assignments list filter.
      if (isOwner && !isAdmin && row.exerciseStatus === "draft") {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const values = await getTnaResponseValues(request.tenantDb, assignmentId);
      return { success: true, data: { ...row, responseValues: values } };
    },
  );

  // PATCH /tenant/tna-assignments/:assignmentId — save progress on my own response, without
  // submitting. Only the assignment's own owner may write it; only while pending and the exercise
  // is still active.
  fastify.patch<{ Params: { assignmentId: string }; Body: { values?: Record<string, unknown> } }>(
    "/tenant/tna-assignments/:assignmentId",
    { preHandler: [requireTenantUserSession()] },
    async (request, reply) => {
      const { assignmentId } = request.params;
      const [assignment] = await request.tenantDb
        .select({ id: tnaAssignments.id, userId: tnaAssignments.userId, status: tnaAssignments.status, exerciseStatus: tnaExercises.status, endDate: tnaExercises.endDate })
        .from(tnaAssignments)
        .innerJoin(tnaExercises, eq(tnaExercises.id, tnaAssignments.tnaExerciseId))
        .where(eq(tnaAssignments.id, assignmentId));
      if (!assignment || assignment.userId !== request.user!.id) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (assignment.status !== "pending") {
        return reply.code(409).send({ success: false, message: "This response has already been submitted." });
      }
      if (!isExerciseOpenForSubmission(assignment.exerciseStatus, assignment.endDate)) {
        return reply.code(409).send({ success: false, message: "This Training Needs Analysis is not currently accepting responses." });
      }

      const values = request.body?.values ?? {};
      const fields = await getFormFields(request.tenantDb, TNA_RESPONSE_FORM_KEY);
      await writeCustomFieldValues(request.tenantDb, request.user!.tenantId, TNA_RESPONSE_FORM_KEY, assignmentId, values, fields);

      return { success: true, data: { id: assignmentId } };
    },
  );

  // POST /tenant/tna-assignments/:assignmentId/submit — validates required fields, locks the
  // response. Never editable again afterward (no reopen workflow exists — matches the spec's own
  // "no longer edit after submission unless the workflow explicitly supports reopening", and it
  // doesn't here).
  fastify.post<{ Params: { assignmentId: string }; Body: { values?: Record<string, unknown> } }>(
    "/tenant/tna-assignments/:assignmentId/submit",
    { preHandler: [requireTenantUserSession()] },
    async (request, reply) => {
      const { assignmentId } = request.params;
      const [assignment] = await request.tenantDb
        .select({ id: tnaAssignments.id, userId: tnaAssignments.userId, status: tnaAssignments.status, exerciseStatus: tnaExercises.status, endDate: tnaExercises.endDate })
        .from(tnaAssignments)
        .innerJoin(tnaExercises, eq(tnaExercises.id, tnaAssignments.tnaExerciseId))
        .where(eq(tnaAssignments.id, assignmentId));
      if (!assignment || assignment.userId !== request.user!.id) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (assignment.status !== "pending") {
        return reply.code(409).send({ success: false, message: "This response has already been submitted." });
      }
      if (!isExerciseOpenForSubmission(assignment.exerciseStatus, assignment.endDate)) {
        return reply.code(409).send({ success: false, message: "This Training Needs Analysis is not currently accepting responses." });
      }

      const values = request.body?.values ?? {};
      const fields = await getFormFields(request.tenantDb, TNA_RESPONSE_FORM_KEY);
      const errors = validateCustomFieldValues(values, fields);
      if (errors.length > 0) {
        return reply.code(422).send({ success: false, errors });
      }

      await writeCustomFieldValues(request.tenantDb, request.user!.tenantId, TNA_RESPONSE_FORM_KEY, assignmentId, values, fields);
      await request.tenantDb
        .update(tnaAssignments)
        .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
        .where(eq(tnaAssignments.id, assignmentId));

      return { success: true, data: { id: assignmentId } };
    },
  );
};

/** Fire-and-forget assignment-notification email — the only notification this feature sends (no
 * deadline-reminder cron exists in this codebase). Never throws: an email failure must not break the
 * Start/manual-add action that triggered it, matching `sendMail`'s own non-blocking-failure
 * guarantee. Links to the public, no-login magic-link page (`/tna-response?token=...`) via each
 * assignment's raw token — never the session-authenticated `/strategy/training-needs-analysis/my/*`
 * route, so a participant can act on the email without ever needing to log in first (mirrors the
 * `/reset-password?token=...&subdomain=...` link shape `forgot-password` already sends). */
async function notifyTnaParticipants(
  tenantDb: Db,
  tenantId: string,
  exerciseTitle: string,
  endDate: string,
  assignments: { id: string; userId: string; token: string }[],
): Promise<void> {
  if (assignments.length === 0) return;
  try {
    const userIds = Array.from(new Set(assignments.map((a) => a.userId)));
    const recipients = await tenantDb.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, userIds));
    const emailByUserId = new Map(recipients.map((r) => [r.id, r.email]));

    const [tenant] = await tenantDb.select({ subdomain: tenants.subdomain }).from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) return;
    const rootDomain = process.env.ROOT_DOMAIN ?? "tm.com";

    await Promise.all(
      assignments.map((a) => {
        const email = emailByUserId.get(a.userId);
        if (!email) return Promise.resolve();
        const respondUrl = `http://${tenant.subdomain}.${rootDomain}/tna-response?token=${a.token}&subdomain=${tenant.subdomain}`;
        return sendTnaAssignmentEmail(email, exerciseTitle, endDate, respondUrl);
      }),
    );
  } catch (err) {
    console.error("Failed to send TNA assignment notification emails:", err);
  }
}

async function hasAnyTnaAdminPermission(tenantDb: Db, userId: string): Promise<boolean> {
  const [row] = await tenantDb
    .select({ id: permissions.id })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(userRoles.userId, userId), inArray(permissions.key, ["tna.manage", "tna.view"])));
  return !!row;
}

export default tenantTnaRoutes;
