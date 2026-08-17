import type { FastifyPluginAsync } from "fastify";
import { eq, asc, and, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requireAnyPermission } from "../permissions/require-permission";
import { tnaExercises, tnaExerciseTargets, TNA_TARGET_TYPES, type TnaTargetType } from "../db/schema/tna-exercises";
import { tnaAssignments } from "../db/schema/tna-assignments";
import { departments } from "../db/schema/departments";
import { roles, userRoles, rolePermissions } from "../db/schema/roles";
import { users } from "../db/schema/users";
import { permissions } from "../db/schema/permissions";
import { customFieldValues, formFields } from "../db/schema/custom-fields";
import { departmentIsActive } from "../tenant-auth/team-write-validation";
import { resolveTnaParticipants } from "./resolve-tna-participants";
import { getFormFields } from "../custom-fields/field-key-uniqueness";
import { validateCustomFieldValues, writeCustomFieldValues } from "../custom-fields/save-values";
import type { Db } from "../db/client";

const FORM_KEY = "tna_response";

interface TargetInput {
  type: TnaTargetType;
  departmentId?: string;
  roleId?: string;
  userId?: string;
}

interface ExerciseWriteBody {
  title?: string;
  description?: string | null;
  startDate?: string;
  endDate?: string;
  targetsAllDepartments?: boolean;
  targets?: TargetInput[];
}

function validateExerciseBody(body: ExerciseWriteBody, { partial }: { partial: boolean }): string | null {
  if (!partial || body.title !== undefined) {
    if (!body.title || !body.title.trim()) return "title is required";
  }
  if (!partial || body.startDate !== undefined) {
    if (!body.startDate || Number.isNaN(Date.parse(body.startDate))) return "startDate must be a valid date";
  }
  if (!partial || body.endDate !== undefined) {
    if (!body.endDate || Number.isNaN(Date.parse(body.endDate))) return "endDate must be a valid date";
  }
  if (body.startDate && body.endDate && body.startDate > body.endDate) {
    return "endDate must be on or after startDate";
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
    startDate: tnaExercises.startDate,
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
        .orderBy(asc(tnaExercises.startDate));

      const withProgress = await Promise.all(
        rows.map(async (row) => ({ ...row, progress: await getProgressCounts(request.tenantDb, row.id) })),
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
          startDate: body.startDate!,
          endDate: body.endDate!,
          targetsAllDepartments: body.targetsAllDepartments ?? false,
          createdByUserId: request.user!.id,
        })
        .returning();

      if (body.targets) {
        await replaceTargets(request.tenantDb, request.user!.tenantId, created.id, body.targets);
      }

      return reply.code(201).send({ success: true, data: { id: created.id } });
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
          ...(body.startDate !== undefined ? { startDate: body.startDate } : {}),
          ...(body.endDate !== undefined ? { endDate: body.endDate } : {}),
          ...(body.targetsAllDepartments !== undefined ? { targetsAllDepartments: body.targetsAllDepartments } : {}),
          updatedAt: new Date(),
        })
        .where(eq(tnaExercises.id, exerciseId));

      if (body.targets !== undefined) {
        await replaceTargets(request.tenantDb, request.user!.tenantId, exerciseId, body.targets);
      }

      return { success: true, data: { id: exerciseId } };
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

  // POST /tenant/tna-exercises/:exerciseId/start — validates dates, resolves the participant
  // roster once (resolve-tna-participants.ts), materializes tna_assignments, flips status to
  // 'active'. Departments with no manager/assistant manager contribute zero participants but never
  // block Start — surfaced back in the response as a warning instead (spec: "skip with a warning,
  // never silently drop").
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

      const { participants, departmentsWithNoManager } = await resolveTnaParticipants(
        request.tenantDb,
        exerciseId,
        existing.targetsAllDepartments,
      );

      if (participants.length > 0) {
        await request.tenantDb.insert(tnaAssignments).values(
          participants.map((p) => ({
            tenantId: request.user!.tenantId,
            tnaExerciseId: exerciseId,
            userId: p.userId,
            departmentId: p.departmentId,
            sourceTargetType: p.sourceTargetType,
          })),
        );
      }

      await request.tenantDb
        .update(tnaExercises)
        .set({ status: "active", startedAt: new Date(), updatedAt: new Date() })
        .where(eq(tnaExercises.id, exerciseId));

      return {
        success: true,
        data: { id: exerciseId, participantsAssigned: participants.length, departmentsWithNoManager },
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

  fastify.post<{ Params: { exerciseId: string } }>(
    "/tenant/tna-exercises/:exerciseId/commit",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("tna.manage")] },
    async (request, reply) => {
      const { exerciseId } = request.params;
      const [existing] = await request.tenantDb.select().from(tnaExercises).where(eq(tnaExercises.id, exerciseId));
      if (!existing) return reply.code(404).send({ success: false, message: "Not found" });
      if (existing.status !== "under_review") {
        return reply.code(409).send({ success: false, message: "Only an exercise under review can be committed." });
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

      const values = await getCustomFieldValues(request.tenantDb, assignmentId);
      return { success: true, data: { ...row, responseValues: values } };
    },
  );

  // GET /tenant/my-tna-assignments — a participant's own assignments across every exercise, no
  // tna.* permission required (assignment ownership is the access rule).
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
          startDate: tnaExercises.startDate,
          endDate: tnaExercises.endDate,
        })
        .from(tnaAssignments)
        .innerJoin(tnaExercises, eq(tnaExercises.id, tnaAssignments.tnaExerciseId))
        .leftJoin(departments, eq(departments.id, tnaAssignments.departmentId))
        .where(eq(tnaAssignments.userId, request.user!.id))
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
          startDate: tnaExercises.startDate,
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

      const values = await getCustomFieldValues(request.tenantDb, assignmentId);
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
      const fields = await getFormFields(request.tenantDb, FORM_KEY);
      await writeCustomFieldValues(request.tenantDb, request.user!.tenantId, FORM_KEY, assignmentId, values, fields);

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
      const fields = await getFormFields(request.tenantDb, FORM_KEY);
      const errors = validateCustomFieldValues(values, fields);
      if (errors.length > 0) {
        return reply.code(422).send({ success: false, errors });
      }

      await writeCustomFieldValues(request.tenantDb, request.user!.tenantId, FORM_KEY, assignmentId, values, fields);
      await request.tenantDb
        .update(tnaAssignments)
        .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
        .where(eq(tnaAssignments.id, assignmentId));

      return { success: true, data: { id: assignmentId } };
    },
  );
};

function isExerciseOpenForSubmission(exerciseStatus: string, endDate: string): boolean {
  if (exerciseStatus !== "active") return false;
  const today = new Date().toISOString().slice(0, 10);
  return today <= endDate;
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

async function getCustomFieldValues(tenantDb: Db, entityId: string): Promise<Record<string, unknown>> {
  const rows = await tenantDb
    .select({ fieldKey: formFields.fieldKey, value: customFieldValues.value })
    .from(customFieldValues)
    .innerJoin(formFields, eq(formFields.id, customFieldValues.fieldId))
    .where(eq(customFieldValues.entityId, entityId));
  return Object.fromEntries(rows.map((r) => [r.fieldKey, r.value]));
}

export default tenantTnaRoutes;
