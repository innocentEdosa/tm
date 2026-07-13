import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
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

const DEFAULT_PAGE_SIZE = 25;
const FORM_KEY = "training_needs_analysis";
const PRIORITIES = ["low", "medium", "high"] as const;
type Priority = (typeof PRIORITIES)[number];

/** Whether `callerUserId` holds `permissionKey` — same query shape as `requirePermission`
 * (`permissions/require-permission.ts`), used here for in-handler branching (e.g. "does this caller
 * additionally hold tna.manage.all") rather than as a route-blocking preHandler. */
async function hasPermission(tenantDb: Db, callerUserId: string, permissionKey: string): Promise<boolean> {
  const [row] = await tenantDb
    .select({ id: permissions.id })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(userRoles.userId, callerUserId), eq(permissions.key, permissionKey)));
  return !!row;
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
  return scope.kind === "all" ? row.status === "submitted" : true;
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
    submittedAt: trainingNeeds.submittedAt,
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
    Querystring: { department?: string; priority?: string; page?: string; pageSize?: string };
  }>(
    "/tenant/training-needs",
    {
      preHandler: [
        requireTenantUserSession(),
        requireAnyPermission("tna.view.all", "tna.view.department"),
      ],
    },
    async (request) => {
      const tenantId = request.user!.tenantId;
      const viewAll = await hasPermission(request.tenantDb, request.user!.id, "tna.view.all");
      const scope = await resolveTrainingNeedVisibilityScope(request.tenantDb, request.user!.id, viewAll);

      if (scope.kind === "no_department_assigned") {
        return { success: true, data: [] };
      }

      const conditions = [eq(trainingNeeds.tenantId, tenantId)];

      if (scope.kind === "department") {
        conditions.push(inArray(trainingNeeds.departmentId, scope.departmentIds));
      } else {
        // Org-wide (tna.view.all): Submitted-only — Drafts stay private to their authoring
        // department, never shown here regardless of department filter (research.md §2).
        conditions.push(eq(trainingNeeds.status, "submitted"));
        if (request.query.department) {
          const departmentIds = await collectSubtreeIds(request.tenantDb, request.query.department);
          conditions.push(inArray(trainingNeeds.departmentId, departmentIds));
        }
      }

      if (request.query.priority) {
        conditions.push(eq(trainingNeeds.priority, request.query.priority));
      }

      const baseQuery = request.tenantDb
        .select(selectRow())
        .from(trainingNeeds)
        .leftJoin(departments, eq(departments.id, trainingNeeds.departmentId))
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
  // Q3), a `tna.manage.all` holder can always open a specific record directly by id, Draft or not —
  // mirrors PATCH/DELETE's own `isWithinScope` treatment (no status filter at all for manage.all),
  // not `isVisible`'s stricter view-scope rule — they can already PATCH/DELETE it regardless of
  // status, so gating the GET behind the same submitted-only rule as `tna.view.all` made it
  // impossible to load the very data a manage.all caller is about to edit (e.g. immediately after
  // creating a Draft on another department's behalf).
  fastify.get<{ Params: { trainingNeedId: string } }>(
    "/tenant/training-needs/:trainingNeedId",
    {
      preHandler: [
        requireTenantUserSession(),
        requireAnyPermission("tna.view.all", "tna.view.department", "tna.manage.all", "tna.manage.department"),
      ],
    },
    async (request, reply) => {
      const { trainingNeedId } = request.params;

      const [row] = await request.tenantDb
        .select(selectRow())
        .from(trainingNeeds)
        .leftJoin(departments, eq(departments.id, trainingNeeds.departmentId))
        .where(eq(trainingNeeds.id, trainingNeedId));
      if (!row) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const manageAll = await hasPermission(request.tenantDb, request.user!.id, "tna.manage.all");
      if (manageAll) {
        return { success: true, data: row };
      }

      const viewAll = await hasPermission(request.tenantDb, request.user!.id, "tna.view.all");
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
        requireAnyPermission("tna.manage.all", "tna.manage.department"),
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

      const manageAll = await hasPermission(request.tenantDb, request.user!.id, "tna.manage.all");

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
        // tna.manage.department-only: department is auto-scoped to the caller's own, never
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

      return reply.code(201).send({ success: true, data: { ...created, departmentName: department?.name ?? null } });
    },
  );

  // PATCH /tenant/training-needs/:trainingNeedId — spec US1 (edit/submit), contracts §PATCH.
  fastify.patch<{ Params: { trainingNeedId: string }; Body: TrainingNeedWriteBody }>(
    "/tenant/training-needs/:trainingNeedId",
    {
      preHandler: [
        requireTenantUserSession(),
        requireAnyPermission("tna.manage.all", "tna.manage.department"),
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

      const manageAll = await hasPermission(request.tenantDb, request.user!.id, "tna.manage.all");
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

      return reply.code(200).send({ success: true, data: { ...updated, departmentName: department?.name ?? null } });
    },
  );

  // DELETE /tenant/training-needs/:trainingNeedId — spec US1/US2 (Clarification Q1), contracts §DELETE.
  fastify.delete<{ Params: { trainingNeedId: string } }>(
    "/tenant/training-needs/:trainingNeedId",
    {
      preHandler: [
        requireTenantUserSession(),
        requireAnyPermission("tna.manage.all", "tna.manage.department"),
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

      const manageAll = await hasPermission(request.tenantDb, request.user!.id, "tna.manage.all");
      if (manageAll) {
        // tna.manage.all: any row, any status, any department (research.md §3).
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
