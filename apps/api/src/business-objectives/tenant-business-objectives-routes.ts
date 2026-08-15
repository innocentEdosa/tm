import type { FastifyPluginAsync } from "fastify";
import { eq, asc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requireAnyPermission } from "../permissions/require-permission";
import { businessObjectives } from "../db/schema/business-objectives";
import { businessObjectiveCategories } from "../db/schema/business-objective-categories";
import { departments } from "../db/schema/departments";
import { users } from "../db/schema/users";
import { departmentIsActive } from "../tenant-auth/team-write-validation";
import { resolveOrCreateBusinessObjectiveCategory } from "./business-objective-category-resolution";
import { getFormFields } from "../custom-fields/field-key-uniqueness";
import { validateCustomFieldValues, writeCustomFieldValues } from "../custom-fields/save-values";

const PRIORITIES = ["low", "medium", "high"] as const;
type Priority = (typeof PRIORITIES)[number];

const STATUSES = ["not_started", "on_track", "at_risk", "done"] as const;
type Status = (typeof STATUSES)[number];

// Form Builder spec (033) — registered via 0139_register_business_objective_form_type.sql. The
// nine hand-rolled columns below are this form's "system" fields (module-hardcoded controls,
// matched by field_key in business-objective-form.tsx's fieldRenderers map); a tenant's own
// custom fields, added through Settings > Forms, are read/written through this same generic
// mechanism, exactly like training_needs_analysis does.
const FORM_KEY = "business_objective";

// Tenant-wide list (no per-row scoping split like training_needs' department subtree) — the
// frontend fetches this generously-limited list once and sorts/paginates client-side, mirroring
// courses-list-client.tsx's own FETCH_PAGE_SIZE/DISPLAY_PAGE_SIZE convention, rather than a
// server-driven page/pageSize query.
const LIST_LIMIT = 500;

const creator = alias(users, "bo_creator");

function selectRow() {
  return {
    id: businessObjectives.id,
    title: businessObjectives.title,
    categoryId: businessObjectives.categoryId,
    categoryName: businessObjectiveCategories.name,
    description: businessObjectives.description,
    ownerDepartmentId: businessObjectives.ownerDepartmentId,
    ownerDepartmentName: departments.name,
    dueDate: businessObjectives.dueDate,
    priority: businessObjectives.priority,
    metricName: businessObjectives.metricName,
    baselineValue: businessObjectives.baselineValue,
    targetValue: businessObjectives.targetValue,
    status: businessObjectives.status,
    createdByUserId: businessObjectives.createdByUserId,
    createdByName: creator.fullName,
    createdAt: businessObjectives.createdAt,
    updatedAt: businessObjectives.updatedAt,
  };
}

interface BusinessObjectiveWriteBody {
  title?: string;
  category?: string;
  description?: string | null;
  ownerDepartmentId?: string;
  dueDate?: string;
  priority?: Priority;
  metricName?: string;
  baselineValue?: number | null;
  targetValue?: number | null;
  status?: Status;
  customFieldValues?: Record<string, unknown>;
}

function validateWriteBody(
  body: BusinessObjectiveWriteBody,
  { partial }: { partial: boolean },
): string | null {
  if (!partial || body.title !== undefined) {
    if (!body.title || !body.title.trim()) return "title is required";
  }
  if (!partial || body.category !== undefined) {
    if (!body.category || !body.category.trim()) return "category is required";
  }
  if (!partial || body.ownerDepartmentId !== undefined) {
    if (!body.ownerDepartmentId) return "ownerDepartmentId is required";
  }
  if (!partial || body.dueDate !== undefined) {
    if (!body.dueDate || Number.isNaN(Date.parse(body.dueDate))) return "dueDate must be a valid date";
  }
  if (!partial || body.priority !== undefined) {
    if (!body.priority || !PRIORITIES.includes(body.priority)) {
      return "priority must be one of low, medium, high";
    }
  }
  if (!partial || body.metricName !== undefined) {
    if (!body.metricName || !body.metricName.trim()) return "metricName is required";
  }
  if (body.targetValue !== undefined && body.targetValue !== null && Number.isNaN(Number(body.targetValue))) {
    return "targetValue must be a number";
  }
  if (body.baselineValue !== undefined && body.baselineValue !== null && Number.isNaN(Number(body.baselineValue))) {
    return "baselineValue must be a number";
  }
  if (body.status !== undefined && !STATUSES.includes(body.status)) {
    return `status must be one of ${STATUSES.join(", ")}`;
  }
  return null;
}

/** List/create/edit/delete for company-level Business Objectives (Strategy nav). Tenant-wide, no
 * department-scoped *visibility* split — every route just gates on
 * `business_objective.view`/`.manage` and otherwise operates through `request.tenantDb`
 * (RLS-scoped to the caller's tenant). The objective's own "Owner" is a responsible department
 * (`ownerDepartmentId`), not an individual user — resolved/validated the same way
 * `training_needs.department_id` is (`departmentIsActive`). `category` resolves through the
 * tenant-extensible `business_objective_categories` catalog via the same resolve-or-create-by-name
 * pattern as `courses.category_id` (`resolveOrCreateBusinessObjectiveCategory`), so the frontend can
 * offer a search-or-create combobox instead of a fixed list. */
const tenantBusinessObjectivesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/tenant/business-objectives",
    {
      preHandler: [
        requireTenantUserSession(),
        requireAnyPermission("business_objective.view", "business_objective.manage"),
      ],
    },
    async (request) => {
      const rows = await request.tenantDb
        .select(selectRow())
        .from(businessObjectives)
        .leftJoin(businessObjectiveCategories, eq(businessObjectiveCategories.id, businessObjectives.categoryId))
        .leftJoin(departments, eq(departments.id, businessObjectives.ownerDepartmentId))
        .leftJoin(creator, eq(creator.id, businessObjectives.createdByUserId))
        .orderBy(asc(businessObjectives.dueDate))
        .limit(LIST_LIMIT);

      return { success: true, data: rows };
    },
  );

  // GET /tenant/business-objectives/categories — mirrors GET /tenant/courses/categories exactly
  // (tenant-course-routes.ts): no permission beyond a valid session, since the category list itself
  // isn't sensitive and any tenant user should be able to see/search it while typing into the
  // combobox. Fastify's radix-tree router matches this static path ahead of
  // `:businessObjectiveId` below regardless of registration order, so "categories" is never
  // captured as an objective id.
  fastify.get(
    "/tenant/business-objectives/categories",
    { preHandler: [requireTenantUserSession()] },
    async (request) => {
      const rows = await request.tenantDb
        .select({ id: businessObjectiveCategories.id, name: businessObjectiveCategories.name })
        .from(businessObjectiveCategories)
        .orderBy(businessObjectiveCategories.name);
      return { success: true, data: rows };
    },
  );

  fastify.get<{ Params: { businessObjectiveId: string } }>(
    "/tenant/business-objectives/:businessObjectiveId",
    {
      preHandler: [
        requireTenantUserSession(),
        requireAnyPermission("business_objective.view", "business_objective.manage"),
      ],
    },
    async (request, reply) => {
      const { businessObjectiveId } = request.params;
      const [row] = await request.tenantDb
        .select(selectRow())
        .from(businessObjectives)
        .leftJoin(businessObjectiveCategories, eq(businessObjectiveCategories.id, businessObjectives.categoryId))
        .leftJoin(departments, eq(departments.id, businessObjectives.ownerDepartmentId))
        .leftJoin(creator, eq(creator.id, businessObjectives.createdByUserId))
        .where(eq(businessObjectives.id, businessObjectiveId));
      if (!row) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      return { success: true, data: row };
    },
  );

  fastify.post<{ Body: BusinessObjectiveWriteBody }>(
    "/tenant/business-objectives",
    {
      preHandler: [requireTenantUserSession(), requireAnyPermission("business_objective.manage")],
    },
    async (request, reply) => {
      const body = request.body ?? {};
      const validationError = validateWriteBody(body, { partial: false });
      if (validationError) {
        return reply.code(400).send({ success: false, message: validationError });
      }

      if (!(await departmentIsActive(request.tenantDb, body.ownerDepartmentId!))) {
        return reply.code(422).send({ success: false, message: "Owning department not found or not active" });
      }

      const category = await resolveOrCreateBusinessObjectiveCategory(
        request.tenantDb,
        request.user!.tenantId,
        body.category!,
        request.user!.id,
      );

      // Validated before the insert (save-values.ts's own commit-on-response caveat) — Business
      // Objectives has no draft/submit workflow the way training_needs does, so every create
      // validates any tenant-added custom fields unconditionally.
      const fields = await getFormFields(request.tenantDb, FORM_KEY);
      const customFieldErrors = validateCustomFieldValues(body.customFieldValues ?? {}, fields);
      if (customFieldErrors.length > 0) {
        return reply.code(422).send({ success: false, errors: customFieldErrors });
      }

      const [created] = await request.tenantDb
        .insert(businessObjectives)
        .values({
          tenantId: request.user!.tenantId,
          title: body.title!.trim(),
          categoryId: category.id,
          description: body.description?.trim() || null,
          ownerDepartmentId: body.ownerDepartmentId!,
          dueDate: body.dueDate!,
          priority: body.priority!,
          metricName: body.metricName!.trim(),
          baselineValue: body.baselineValue ?? null,
          targetValue: body.targetValue ?? null,
          status: body.status ?? "not_started",
          createdByUserId: request.user!.id,
        })
        .returning();

      if (body.customFieldValues) {
        await writeCustomFieldValues(
          request.tenantDb,
          request.user!.tenantId,
          FORM_KEY,
          created.id,
          body.customFieldValues,
          fields,
        );
      }

      const [row] = await request.tenantDb
        .select(selectRow())
        .from(businessObjectives)
        .leftJoin(businessObjectiveCategories, eq(businessObjectiveCategories.id, businessObjectives.categoryId))
        .leftJoin(departments, eq(departments.id, businessObjectives.ownerDepartmentId))
        .leftJoin(creator, eq(creator.id, businessObjectives.createdByUserId))
        .where(eq(businessObjectives.id, created.id));

      return reply.code(201).send({ success: true, data: row });
    },
  );

  fastify.patch<{ Params: { businessObjectiveId: string }; Body: BusinessObjectiveWriteBody }>(
    "/tenant/business-objectives/:businessObjectiveId",
    {
      preHandler: [requireTenantUserSession(), requireAnyPermission("business_objective.manage")],
    },
    async (request, reply) => {
      const { businessObjectiveId } = request.params;
      const [existing] = await request.tenantDb
        .select({ id: businessObjectives.id })
        .from(businessObjectives)
        .where(eq(businessObjectives.id, businessObjectiveId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const body = request.body ?? {};
      const validationError = validateWriteBody(body, { partial: true });
      if (validationError) {
        return reply.code(400).send({ success: false, message: validationError });
      }

      if (body.ownerDepartmentId !== undefined) {
        if (!(await departmentIsActive(request.tenantDb, body.ownerDepartmentId))) {
          return reply.code(422).send({ success: false, message: "Owning department not found or not active" });
        }
      }

      let categoryId: string | undefined;
      if (body.category !== undefined) {
        const category = await resolveOrCreateBusinessObjectiveCategory(
          request.tenantDb,
          request.user!.tenantId,
          body.category,
          request.user!.id,
        );
        categoryId = category.id;
      }

      const fields = await getFormFields(request.tenantDb, FORM_KEY);
      if (body.customFieldValues !== undefined) {
        const customFieldErrors = validateCustomFieldValues(body.customFieldValues, fields);
        if (customFieldErrors.length > 0) {
          return reply.code(422).send({ success: false, errors: customFieldErrors });
        }
      }

      await request.tenantDb
        .update(businessObjectives)
        .set({
          ...(body.title !== undefined ? { title: body.title.trim() } : {}),
          ...(categoryId !== undefined ? { categoryId } : {}),
          ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}),
          ...(body.ownerDepartmentId !== undefined ? { ownerDepartmentId: body.ownerDepartmentId } : {}),
          ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.metricName !== undefined ? { metricName: body.metricName.trim() } : {}),
          ...(body.baselineValue !== undefined ? { baselineValue: body.baselineValue } : {}),
          ...(body.targetValue !== undefined ? { targetValue: body.targetValue } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          updatedAt: new Date(),
        })
        .where(eq(businessObjectives.id, businessObjectiveId));

      if (body.customFieldValues) {
        await writeCustomFieldValues(
          request.tenantDb,
          request.user!.tenantId,
          FORM_KEY,
          businessObjectiveId,
          body.customFieldValues,
          fields,
        );
      }

      const [row] = await request.tenantDb
        .select(selectRow())
        .from(businessObjectives)
        .leftJoin(businessObjectiveCategories, eq(businessObjectiveCategories.id, businessObjectives.categoryId))
        .leftJoin(departments, eq(departments.id, businessObjectives.ownerDepartmentId))
        .leftJoin(creator, eq(creator.id, businessObjectives.createdByUserId))
        .where(eq(businessObjectives.id, businessObjectiveId));

      return reply.code(200).send({ success: true, data: row });
    },
  );

  fastify.delete<{ Params: { businessObjectiveId: string } }>(
    "/tenant/business-objectives/:businessObjectiveId",
    {
      preHandler: [requireTenantUserSession(), requireAnyPermission("business_objective.manage")],
    },
    async (request, reply) => {
      const { businessObjectiveId } = request.params;
      const [existing] = await request.tenantDb
        .select({ id: businessObjectives.id })
        .from(businessObjectives)
        .where(eq(businessObjectives.id, businessObjectiveId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      await request.tenantDb.delete(businessObjectives).where(eq(businessObjectives.id, businessObjectiveId));
      return reply.code(204).send();
    },
  );
};

export default tenantBusinessObjectivesRoutes;
