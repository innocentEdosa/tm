import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../db/client";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requireAnyPermission } from "../permissions/require-permission";
import { trainingNeeds } from "../db/schema/training-needs";
import { departments } from "../db/schema/departments";
import { users } from "../db/schema/users";
import { userRoles, rolePermissions } from "../db/schema/roles";
import { permissions } from "../db/schema/permissions";
import { departmentIsActive } from "../tenant-auth/team-write-validation";
import { collectSubtreeIds } from "../departments/department-hierarchy";
import {
  resolveTrainingNeedVisibilityScope,
  type TrainingNeedVisibilityScope,
} from "./training-need-visibility";
import { getFormFields } from "../custom-fields/field-key-uniqueness";
import { validateCustomFieldValues, writeCustomFieldValues } from "../custom-fields/save-values";
import { getAllowMultipleResponses } from "../form-builder/response-policy";
import { listUsersWithPermission } from "../permissions/require-permission";
import { createNotification, createNotifications, truncateForNotification } from "../notifications/notification-service";

const DEFAULT_PAGE_SIZE = 25;
const FORM_KEY = "training_needs_analysis";
const PRIORITIES = ["low", "medium", "high"] as const;
type Priority = (typeof PRIORITIES)[number];

// Two independent name lookups against the same `users` table — who created the entry, and who (if
// anyone) approved it — so each needs its own alias to join twice in one query.
const creator = alias(users, "tna_creator");
const approver = alias(users, "tna_approver");

/** Whether `callerUserId` holds `permissionKey` — same query shape as `requirePermission`
 * (`permissions/require-permission.ts`), used here for in-handler branching (e.g. "does this caller
 * additionally hold training_request.manage.all") rather than as a route-blocking preHandler. */
async function hasPermission(tenantDb: Db, callerUserId: string, permissionKey: string): Promise<boolean> {
  const [row] = await tenantDb
    .select({ id: permissions.id })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(userRoles.userId, callerUserId), eq(permissions.key, permissionKey)));
  return !!row;
}

/** Notifies everyone holding `training_request.approve` that a request needs their attention —
 * fired on every submit (both create-as-submitted and edit-then-submit), never on a plain draft save.
 * Uses the same `listUsersWithPermission` helper `require-permission.ts` already exposes for Course
 * Marketplace's own "who holds this permission" fan-out, rather than inventing a second way to
 * resolve recipients by permission.
 *
 * Self-contained try/catch (mirrors `tna/tenant-tna-routes.ts`'s `notifyTnaParticipants` convention)
 * — a notification failure must never fail the submit itself, so callers just `await` this and don't
 * need their own error handling. */
async function notifyApprovers(tenantDb: Db, tenantId: string, trainingNeedId: string, title: string): Promise<void> {
  try {
    const approvers = await listUsersWithPermission(tenantDb, "training_request.approve");
    if (approvers.length === 0) return;
    await createNotifications(tenantDb, {
      tenantId,
      recipientIds: approvers.map((a) => a.id),
      type: "training_request_submitted",
      title: "Training request awaiting approval",
      message: `"${truncateForNotification(title)}" was submitted and needs your approval.`,
      metadata: { entityType: "training_need", entityId: trainingNeedId },
      actionUrl: `/learning/training-requests/${trainingNeedId}`,
    });
  } catch (err) {
    console.error("Failed to create training request submitted notifications:", err);
  }
}

/** Notifies the request's own creator once it's approved — same self-contained try/catch reasoning
 * as `notifyApprovers` above. */
async function notifyCreatorOfApproval(tenantDb: Db, tenantId: string, trainingNeedId: string, title: string, creatorUserId: string): Promise<void> {
  try {
    await createNotification(tenantDb, {
      tenantId,
      recipientId: creatorUserId,
      type: "training_request_approved",
      title: "Training request approved",
      message: `Your training request "${truncateForNotification(title)}" has been approved.`,
      metadata: { entityType: "training_need", entityId: trainingNeedId },
      actionUrl: `/learning/training-requests/${trainingNeedId}`,
    });
  } catch (err) {
    console.error("Failed to create training request approved notification:", err);
  }
}

/** research.md §9 — a row is only ever within scope (visible or manageable) at all if it's within
 * the caller's org-wide/department-subtree scope; org-wide *visibility* additionally requires
 * Submitted (draft-privacy, research.md §2) — callers needing that stricter check apply it on top of
 * this one (see `isVisible` below), since "manage" scope (PATCH/DELETE) is not status-restricted the
 * same way. */
function isWithinScope(departmentId: string, scope: TrainingNeedVisibilityScope): boolean {
  if (scope.kind === "no_department_assigned") return false;
  if (scope.kind === "all") return true;
  return scope.departmentIds.includes(departmentId);
}

function isVisible(row: { departmentId: string; status: string }, scope: TrainingNeedVisibilityScope): boolean {
  if (!isWithinScope(row.departmentId, scope)) return false;
  // Draft-privacy (research.md §2): org-wide scope excludes only Drafts, not Approved — an
  // approved entry is still "not a draft" and must stay visible in the org-wide view it was
  // approved from, not disappear the moment it's approved.
  return scope.kind === "all" ? row.status !== "draft" : true;
}

function selectRow() {
  return {
    id: trainingNeeds.id,
    departmentId: trainingNeeds.departmentId,
    departmentName: departments.name,
    title: trainingNeeds.title,
    priority: trainingNeeds.priority,
    status: trainingNeeds.status,
    createdByUserId: trainingNeeds.createdByUserId,
    createdByName: creator.fullName,
    submittedAt: trainingNeeds.submittedAt,
    approvedByUserId: trainingNeeds.approvedByUserId,
    approvedByName: approver.fullName,
    approvedAt: trainingNeeds.approvedAt,
    createdAt: trainingNeeds.createdAt,
    updatedAt: trainingNeeds.updatedAt,
  };
}

interface TrainingNeedWriteBody {
  departmentId?: string;
  title?: string;
  priority?: Priority;
  status?: "draft" | "submitted";
  customFieldValues?: Record<string, unknown>;
}

/** contracts/training-needs-api.md. All routes operate through `request.tenantDb` (RLS-scoped,
 * tenant boundary only) — department/status visibility is enforced here in the handler, not via RLS
 * (research.md §1/§2). Custom field values are read/written through the existing, unmodified Spec
 * 010 endpoints with `formKey=training_needs_analysis` — not duplicated here. */
const tenantTrainingNeedsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /tenant/training-needs — spec US1/US2, contracts §GET (list).
  fastify.get<{
    Querystring: { department?: string; priority?: string; status?: string; page?: string; pageSize?: string };
  }>(
    "/tenant/training-needs",
    {
      preHandler: [
        requireTenantUserSession(),
        requireAnyPermission(
          "training_request.view.all",
          "training_request.view.department",
          "training_request.manage.all",
          "training_request.manage.department",
          "training_request.approve",
        ),
      ],
    },
    async (request) => {
      const tenantId = request.user!.tenantId;
      // A permission that lets you act on any entry (manage.all) or approve any entry (training_request.approve)
      // must also let you find it — otherwise there'd be no way to discover what's awaiting
      // approval without already knowing its id (research.md §9's own "manage implies view" logic,
      // extended here to the list endpoint, not just GET-by-id).
      const viewAll =
        (await hasPermission(request.tenantDb, request.user!.id, "training_request.view.all")) ||
        (await hasPermission(request.tenantDb, request.user!.id, "training_request.manage.all")) ||
        (await hasPermission(request.tenantDb, request.user!.id, "training_request.approve"));
      const scope = await resolveTrainingNeedVisibilityScope(request.tenantDb, request.user!.id, viewAll);

      if (scope.kind === "no_department_assigned") {
        return { success: true, data: [] };
      }

      const conditions = [eq(trainingNeeds.tenantId, tenantId)];

      if (scope.kind === "department") {
        conditions.push(inArray(trainingNeeds.departmentId, scope.departmentIds));
      } else {
        // Org-wide (training_request.view.all): everything except Drafts — Drafts stay private to their
        // authoring department, never shown here regardless of department filter (research.md
        // §2); Submitted and Approved both remain visible once submitted.
        conditions.push(ne(trainingNeeds.status, "draft"));
        if (request.query.department) {
          const departmentIds = await collectSubtreeIds(request.tenantDb, request.query.department);
          conditions.push(inArray(trainingNeeds.departmentId, departmentIds));
        }
      }

      if (request.query.priority) {
        conditions.push(eq(trainingNeeds.priority, request.query.priority));
      }
      if (request.query.status) {
        conditions.push(eq(trainingNeeds.status, request.query.status));
      }

      const baseQuery = request.tenantDb
        .select(selectRow())
        .from(trainingNeeds)
        .leftJoin(departments, eq(departments.id, trainingNeeds.departmentId))
        .leftJoin(creator, eq(creator.id, trainingNeeds.createdByUserId))
        .leftJoin(approver, eq(approver.id, trainingNeeds.approvedByUserId))
        .where(and(...conditions))
        .orderBy(desc(trainingNeeds.createdAt));

      if (scope.kind === "all") {
        const page = Math.max(1, parseInt(request.query.page ?? "1", 10) || 1);
        const pageSize = Math.max(1, parseInt(request.query.pageSize ?? "", 10) || DEFAULT_PAGE_SIZE);

        const [{ count: total }] = await request.tenantDb
          .select({ count: sql<number>`count(*)::int` })
          .from(trainingNeeds)
          .where(and(...conditions));

        const rows = await baseQuery.limit(pageSize).offset((page - 1) * pageSize);
        return { success: true, data: rows, pagination: { page, pageSize, total } };
      }

      const rows = await baseQuery;
      return { success: true, data: rows };
    },
  );

  // GET /tenant/training-needs/:trainingNeedId — contracts §GET (detail). 404, not 403, when the
  // row is out of the caller's scope (research.md §9) — never confirms a row exists elsewhere.
  // Unlike the list endpoint (which deliberately hides Drafts from org-wide browsing, Clarification
  // Q3), a `training_request.manage.all` holder can always open a specific record directly by id, Draft or not —
  // mirrors PATCH/DELETE's own `isWithinScope` treatment (no status filter at all for manage.all),
  // not `isVisible`'s stricter view-scope rule — they can already PATCH/DELETE it regardless of
  // status, so gating the GET behind the same submitted-only rule as `training_request.view.all` made it
  // impossible to load the very data a manage.all caller is about to edit (e.g. immediately after
  // creating a Draft on another department's behalf).
  fastify.get<{ Params: { trainingNeedId: string } }>(
    "/tenant/training-needs/:trainingNeedId",
    {
      preHandler: [
        requireTenantUserSession(),
        requireAnyPermission(
          "training_request.view.all",
          "training_request.view.department",
          "training_request.manage.all",
          "training_request.manage.department",
          "training_request.approve",
        ),
      ],
    },
    async (request, reply) => {
      const { trainingNeedId } = request.params;

      const [row] = await request.tenantDb
        .select(selectRow())
        .from(trainingNeeds)
        .leftJoin(departments, eq(departments.id, trainingNeeds.departmentId))
        .leftJoin(creator, eq(creator.id, trainingNeeds.createdByUserId))
        .leftJoin(approver, eq(approver.id, trainingNeeds.approvedByUserId))
        .where(eq(trainingNeeds.id, trainingNeedId));
      if (!row) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      // training_request.approve is org-wide, unscoped, same as training_request.manage.all (research.md §3's own precedent)
      // — a pure approver needs to be able to open any entry to act on it, not just their own
      // department's, and not filtered by status the way training_request.view.all's own scope is.
      const manageAll = await hasPermission(request.tenantDb, request.user!.id, "training_request.manage.all");
      const canApprove = await hasPermission(request.tenantDb, request.user!.id, "training_request.approve");
      if (manageAll || canApprove) {
        return { success: true, data: row };
      }

      const viewAll = await hasPermission(request.tenantDb, request.user!.id, "training_request.view.all");
      const scope = await resolveTrainingNeedVisibilityScope(request.tenantDb, request.user!.id, viewAll);
      if (!isVisible(row, scope)) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      return { success: true, data: row };
    },
  );

  // POST /tenant/training-needs — spec US1, contracts §POST.
  fastify.post<{ Body: TrainingNeedWriteBody }>(
    "/tenant/training-needs",
    {
      preHandler: [
        requireTenantUserSession(),
        requireAnyPermission("training_request.manage.all", "training_request.manage.department"),
      ],
    },
    async (request, reply) => {
      const { title, priority, departmentId, status, customFieldValues } = request.body ?? {};
      if (!title || !title.trim()) {
        return reply.code(400).send({ success: false, message: "title is required" });
      }
      if (!priority || !PRIORITIES.includes(priority)) {
        return reply.code(400).send({ success: false, message: "priority must be one of low, medium, high" });
      }

      const manageAll = await hasPermission(request.tenantDb, request.user!.id, "training_request.manage.all");

      let targetDepartmentId: string;
      if (manageAll) {
        if (!departmentId) {
          return reply.code(400).send({ success: false, message: "departmentId is required" });
        }
        if (!(await departmentIsActive(request.tenantDb, departmentId))) {
          return reply.code(422).send({ success: false, message: "Department not found or not active" });
        }
        targetDepartmentId = departmentId;
      } else {
        // training_request.manage.department-only: department is auto-scoped to the caller's own, never
        // client-editable (spec FR-002) — a mismatched departmentId is rejected, not silently
        // overridden, so a caller can't assume a submission landed where they asked.
        const [caller] = await request.tenantDb
          .select({ departmentId: users.departmentId })
          .from(users)
          .where(eq(users.id, request.user!.id));
        if (!caller?.departmentId) {
          return reply.code(403).send({ success: false, message: "Forbidden" });
        }
        if (departmentId && departmentId !== caller.departmentId) {
          return reply.code(403).send({ success: false, message: "Forbidden" });
        }
        targetDepartmentId = caller.departmentId;
      }

      // Multiple form responses feature (form_definitions.allow_multiple_responses) — a
      // respondent (the caller creating this entry, `request.user!.id`) may hold at most one
      // training_needs row while the form type's setting is off. Existing tenants keep today's
      // unrestricted behavior unchanged (migration 0154 backfills this form type's flag to
      // `true`); a Super Admin who later flips it off for this form type is the one opting into
      // this limit. Checked against every status (draft/submitted/approved) — a still-open draft
      // already counts as "your one response", same as a finished one, so the guidance below
      // always points at something the caller can actually go edit.
      if (!(await getAllowMultipleResponses(request.tenantDb, FORM_KEY))) {
        const [existingResponse] = await request.tenantDb
          .select({ id: trainingNeeds.id })
          .from(trainingNeeds)
          .where(and(eq(trainingNeeds.tenantId, request.user!.tenantId), eq(trainingNeeds.createdByUserId, request.user!.id)));
        if (existingResponse) {
          return reply.code(409).send({
            success: false,
            message: "You already have a training request. Edit your existing request, or ask an admin to enable multiple responses for this form.",
            existingResponseId: existingResponse.id,
          });
        }
      }

      const desiredStatus = status === "submitted" ? "submitted" : "draft";

      // Validated before the insert (save-values.ts's own commit-on-response caveat) — Drafts may
      // omit required custom fields (spec FR-004); only a Submit-at-creation validates them.
      const fields = await getFormFields(request.tenantDb, FORM_KEY);
      if (desiredStatus === "submitted") {
        const errors = validateCustomFieldValues(customFieldValues ?? {}, fields);
        if (errors.length > 0) {
          return reply.code(422).send({ success: false, errors });
        }
      }

      const [created] = await request.tenantDb
        .insert(trainingNeeds)
        .values({
          tenantId: request.user!.tenantId,
          departmentId: targetDepartmentId,
          title: title.trim(),
          priority,
          status: desiredStatus,
          createdByUserId: request.user!.id,
          submittedAt: desiredStatus === "submitted" ? new Date() : null,
        })
        .returning();

      if (customFieldValues) {
        await writeCustomFieldValues(
          request.tenantDb,
          request.user!.tenantId,
          FORM_KEY,
          created.id,
          customFieldValues,
          fields,
        );
      }

      const [department] = await request.tenantDb
        .select({ name: departments.name })
        .from(departments)
        .where(eq(departments.id, created.departmentId));

      if (desiredStatus === "submitted") {
        await notifyApprovers(request.tenantDb, request.user!.tenantId, created.id, created.title);
      }

      return reply.code(201).send({ success: true, data: { ...created, departmentName: department?.name ?? null } });
    },
  );

  // PATCH /tenant/training-needs/:trainingNeedId — spec US1 (edit/submit), contracts §PATCH.
  fastify.patch<{ Params: { trainingNeedId: string }; Body: TrainingNeedWriteBody }>(
    "/tenant/training-needs/:trainingNeedId",
    {
      preHandler: [
        requireTenantUserSession(),
        requireAnyPermission("training_request.manage.all", "training_request.manage.department"),
      ],
    },
    async (request, reply) => {
      const { trainingNeedId } = request.params;
      const [existing] = await request.tenantDb
        .select()
        .from(trainingNeeds)
        .where(eq(trainingNeeds.id, trainingNeedId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const manageAll = await hasPermission(request.tenantDb, request.user!.id, "training_request.manage.all");
      const manageScope = await resolveTrainingNeedVisibilityScope(request.tenantDb, request.user!.id, manageAll);
      if (!isWithinScope(existing.departmentId, manageScope)) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const { title, priority, status, customFieldValues } = request.body ?? {};
      if (priority !== undefined && !PRIORITIES.includes(priority)) {
        return reply.code(400).send({ success: false, message: "priority must be one of low, medium, high" });
      }
      if (status !== undefined && status !== "submitted") {
        return reply.code(400).send({ success: false, message: "status can only be set to 'submitted'" });
      }

      // Editing (title/priority/custom fields) is allowed in either status without resetting it
      // (spec FR-006) — submitting is the only status-changing action, and only a legal transition
      // from Draft; already-Submitted -> submitted is a no-op, not an error (contracts §PATCH).
      const willSubmit = status === "submitted" && existing.status === "draft";

      const fields = await getFormFields(request.tenantDb, FORM_KEY);
      if (willSubmit) {
        const errors = validateCustomFieldValues(customFieldValues ?? {}, fields);
        if (errors.length > 0) {
          return reply.code(422).send({ success: false, errors });
        }
      }

      const [updated] = await request.tenantDb
        .update(trainingNeeds)
        .set({
          ...(title !== undefined ? { title: title.trim() } : {}),
          ...(priority !== undefined ? { priority } : {}),
          ...(willSubmit ? { status: "submitted" as const, submittedAt: new Date() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(trainingNeeds.id, trainingNeedId))
        .returning();

      if (customFieldValues) {
        await writeCustomFieldValues(
          request.tenantDb,
          request.user!.tenantId,
          FORM_KEY,
          trainingNeedId,
          customFieldValues,
          fields,
        );
      }

      const [department] = await request.tenantDb
        .select({ name: departments.name })
        .from(departments)
        .where(eq(departments.id, updated.departmentId));

      if (willSubmit) {
        await notifyApprovers(request.tenantDb, request.user!.tenantId, updated.id, updated.title);
      }

      return reply.code(200).send({ success: true, data: { ...updated, departmentName: department?.name ?? null } });
    },
  );

  // POST /tenant/training-needs/:trainingNeedId/approve — approval workflow follow-up
  // (0051/0052 migrations). Gated by the dedicated `training_request.approve` permission, deliberately separate
  // from `training_request.manage.*` — a tenant can grant approval authority without also granting edit/delete
  // rights. Org-wide only, no department-scoped variant or additional visibility-scope check beyond
  // holding the permission itself, mirroring `training_request.manage.all`'s own unscoped treatment.
  fastify.post<{ Params: { trainingNeedId: string } }>(
    "/tenant/training-needs/:trainingNeedId/approve",
    {
      preHandler: [requireTenantUserSession(), requireAnyPermission("training_request.approve")],
    },
    async (request, reply) => {
      const { trainingNeedId } = request.params;
      const [existing] = await request.tenantDb
        .select()
        .from(trainingNeeds)
        .where(eq(trainingNeeds.id, trainingNeedId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      if (existing.status === "draft") {
        return reply.code(409).send({ success: false, message: "Only a Submitted entry can be approved." });
      }

      // Already-approved -> approve is a no-op, not an error (mirrors PATCH's own re-submit
      // precedent) — the original approver/timestamp is preserved, not overwritten. Notifying the
      // creator only happens on the actual transition, not on a repeat no-op call.
      if (existing.status !== "approved") {
        await request.tenantDb
          .update(trainingNeeds)
          .set({
            status: "approved" as const,
            approvedByUserId: request.user!.id,
            approvedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(trainingNeeds.id, trainingNeedId));

        // createdByUserId can be null (creator's account was later deleted) — nothing to notify.
        if (existing.createdByUserId) {
          await notifyCreatorOfApproval(request.tenantDb, request.user!.tenantId, trainingNeedId, existing.title, existing.createdByUserId);
        }
      }

      const [row] = await request.tenantDb
        .select(selectRow())
        .from(trainingNeeds)
        .leftJoin(departments, eq(departments.id, trainingNeeds.departmentId))
        .leftJoin(creator, eq(creator.id, trainingNeeds.createdByUserId))
        .leftJoin(approver, eq(approver.id, trainingNeeds.approvedByUserId))
        .where(eq(trainingNeeds.id, trainingNeedId));

      return reply.code(200).send({ success: true, data: row });
    },
  );

  // DELETE /tenant/training-needs/:trainingNeedId — spec US1/US2 (Clarification Q1), contracts §DELETE.
  fastify.delete<{ Params: { trainingNeedId: string } }>(
    "/tenant/training-needs/:trainingNeedId",
    {
      preHandler: [
        requireTenantUserSession(),
        requireAnyPermission("training_request.manage.all", "training_request.manage.department"),
      ],
    },
    async (request, reply) => {
      const { trainingNeedId } = request.params;
      const [existing] = await request.tenantDb
        .select()
        .from(trainingNeeds)
        .where(eq(trainingNeeds.id, trainingNeedId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const manageAll = await hasPermission(request.tenantDb, request.user!.id, "training_request.manage.all");
      if (manageAll) {
        // training_request.manage.all: any row, any status, any department (research.md §3).
        await request.tenantDb.delete(trainingNeeds).where(eq(trainingNeeds.id, trainingNeedId));
        return reply.code(204).send();
      }

      const manageScope = await resolveTrainingNeedVisibilityScope(request.tenantDb, request.user!.id, false);
      if (!isWithinScope(existing.departmentId, manageScope)) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (existing.status !== "draft") {
        return reply.code(403).send({
          success: false,
          message: "Only Draft entries can be deleted here — ask an HR/L&D Admin to delete a Submitted entry.",
        });
      }

      await request.tenantDb.delete(trainingNeeds).where(eq(trainingNeeds.id, trainingNeedId));
      return reply.code(204).send();
    },
  );
};

export default tenantTrainingNeedsRoutes;
