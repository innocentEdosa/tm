import type { FastifyPluginAsync } from "fastify";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requireAnyPermission } from "../permissions/require-permission";
import { formDefinitions, formFields, formFieldOrderOverrides } from "../db/schema/custom-fields";
import { formSections, formSteps, tenantFormCtaOverrides } from "../db/schema/form-builder";
import { users } from "../db/schema/users";
import { slugify } from "../custom-fields/field-validation";
import { getEffectiveForm } from "./get-effective-form";
import { assertFieldCanBeHidden, FieldCannotBeHiddenError } from "./visibility-rules";
import { FormService, type FieldType } from "./form-service";

/** Maps a `FormService` failure to the exact same status code/message every route here already
 * used before the Phase 1 (AI Foundation) extraction — behavior-preserving, not a new contract. */
function sendFormServiceError(reply: import("fastify").FastifyReply, error: { code: "not_found" | "conflict" | "invalid"; message: string }) {
  const statusCode = error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 400;
  return reply.code(statusCode).send({ success: false, message: error.message });
}

interface CreateTenantFieldBody {
  label?: string;
  fieldKey?: string;
  fieldType?: FieldType;
  description?: string;
  placeholder?: string;
  options?: string[];
  defaultValue?: unknown;
  validation?: Record<string, unknown>;
  isRequired?: boolean;
  layout?: { colSpan?: number };
  sectionKey?: string;
}

interface PatchTenantFieldBody {
  label?: string;
  fieldType?: FieldType;
  description?: string;
  placeholder?: string;
  options?: string[];
  defaultValue?: unknown;
  validation?: Record<string, unknown>;
  isRequired?: boolean;
  layout?: { colSpan?: number };
  archived?: boolean;
  /** Form Builder follow-up: "we should be able to drag fields between steps" — moves this
   * tenant's own field into a different section (any section: platform's or another of this
   * tenant's own), searched the same way `resolveSectionId` already does for field creation.
   * Only ever reaches a tenant-owned row to begin with (this route's own `tenantId` scoping
   * below) — a platform/system field's placement is never touched through here. */
  sectionKey?: string;
}

/** contracts/form-builder-api.md "Tenant routes". Reuses `forms.manage.tenant` for every
 * write action here (research.md §7 — no new permission key introduced) and
 * `requireTenantUserSession()` alone for the read-only effective-form endpoint, mirroring spec
 * 010's existing "the entity's own permission gates the page" reasoning (spec FR-010). */
const tenantFormBuilderRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /tenant/forms/user-search?search=|ids= — backs the generic "user_select" field type
  // (UserSelectField.tsx), the reusable version of the search-and-select-a-user pattern
  // Department's Manager/Assistant Manager pickers pioneered. Deliberately gated only by
  // `requireTenantUserSession()`, unlike `GET /tenant/users` (kept exactly as-is, still scoped to
  // Department/Course use only, per its own comment) — any tenant user filling out any form with
  // a user-select field needs to search the directory, and name+email isn't sensitive. `ids`
  // resolves a previously-selected value (the stored custom-field value is just the user's id)
  // back into display info; `search` powers the type-ahead.
  fastify.get<{ Querystring: { search?: string; ids?: string } }>(
    "/tenant/forms/user-search",
    { preHandler: [requireTenantUserSession()] },
    async (request, reply) => {
      const { search, ids } = request.query;
      if (ids) {
        const idList = ids
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (idList.length === 0) return { success: true, data: [] };
        const rows = await request.tenantDb
          .select({ id: users.id, fullName: users.fullName, email: users.email })
          .from(users)
          .where(inArray(users.id, idList));
        return { success: true, data: rows };
      }

      const trimmed = search?.trim();
      if (!trimmed) {
        return reply.code(400).send({ success: false, message: "search or ids is required" });
      }
      const pattern = `%${trimmed}%`;
      const rows = await request.tenantDb
        .select({ id: users.id, fullName: users.fullName, email: users.email })
        .from(users)
        .where(or(sql`${users.fullName} ILIKE ${pattern}`, sql`${users.email} ILIKE ${pattern}`))
        .limit(20);
      return { success: true, data: rows };
    },
  );

  fastify.get<{ Params: { formKey: string } }>(
    "/tenant/forms/:formKey/effective",
    { preHandler: [requireTenantUserSession()] },
    async (request) => {
      const data = await getEffectiveForm(request.tenantDb, request.params.formKey, request.user!.tenantId);
      return { success: true, data };
    },
  );

  // GET /tenant/forms/:formKey/structure — the raw step/section list (ids + ownership),
  // including empty ones `getEffectiveForm`/`getFormFields` would never surface since they only
  // ever iterate fields. Backs the tenant builder canvas's own step/section CRUD (edit/delete
  // targets a real id, and a brand-new tenant step/section must be visible before it has any
  // fields) — never used for actual form rendering, so gated the same as every other builder
  // write action here rather than the read-only `.../effective` route above.
  fastify.get<{ Params: { formKey: string } }>(
    "/tenant/forms/:formKey/structure",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("forms.manage.tenant")] },
    async (request, reply) => {
      const { formKey } = request.params;
      const tenantId = request.user!.tenantId;

      const [definition] = await request.tenantDb
        .select({ id: formDefinitions.id, activeVersionId: formDefinitions.activeVersionId })
        .from(formDefinitions)
        .where(eq(formDefinitions.key, formKey));
      if (!definition) return reply.code(404).send({ success: false, message: "Unknown form type" });

      const platformSteps = definition.activeVersionId ? await request.tenantDb.select().from(formSteps).where(eq(formSteps.formVersionId, definition.activeVersionId)) : [];
      const tenantSteps = await request.tenantDb.select().from(formSteps).where(and(eq(formSteps.formDefinitionId, definition.id), eq(formSteps.tenantId, tenantId)));
      const allSteps = [...platformSteps, ...tenantSteps].sort((a, b) => a.displayOrder - b.displayOrder);
      const stepById = new Map(allSteps.map((s) => [s.id, s]));

      const platformSections = definition.activeVersionId ? await request.tenantDb.select().from(formSections).where(eq(formSections.formVersionId, definition.activeVersionId)) : [];
      const tenantSections = await request.tenantDb.select().from(formSections).where(and(eq(formSections.formDefinitionId, definition.id), eq(formSections.tenantId, tenantId)));
      const allSections = [...platformSections, ...tenantSections].sort((a, b) => a.displayOrder - b.displayOrder);

      return {
        success: true,
        data: {
          steps: allSteps.map((s) => ({ id: s.id, key: s.key, title: s.title, description: s.description, isTenantOwned: s.tenantId !== null })),
          sections: allSections.map((s) => ({
            id: s.id,
            key: s.key,
            title: s.title,
            stepKey: s.formStepId ? (stepById.get(s.formStepId)?.key ?? null) : null,
            isTenantOwned: s.tenantId !== null,
          })),
        },
      };
    },
  );

  fastify.post<{ Params: { formKey: string }; Body: CreateTenantFieldBody }>(
    "/tenant/forms/:formKey/fields",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("forms.manage.tenant")] },
    async (request, reply) => {
      const { formKey } = request.params;
      const result = await FormService.createField(
        { tenantId: request.user!.tenantId, userId: request.user!.id, db: request.tenantDb },
        formKey,
        request.body ?? { label: "", fieldType: "text" },
      );
      if (!result.ok) {
        return sendFormServiceError(reply, result.error);
      }
      return reply.code(201).send({ success: true, data: result.data });
    },
  );

  fastify.patch<{ Params: { formKey: string; fieldId: string }; Body: PatchTenantFieldBody }>(
    "/tenant/forms/:formKey/fields/:fieldId",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("forms.manage.tenant")] },
    async (request, reply) => {
      const { fieldId } = request.params;
      const result = await FormService.updateField(
        { tenantId: request.user!.tenantId, userId: request.user!.id, db: request.tenantDb },
        request.params.formKey,
        fieldId,
        request.body ?? {},
      );
      if (!result.ok) {
        return sendFormServiceError(reply, result.error);
      }
      return { success: true, data: result.data };
    },
  );

  fastify.patch<{ Params: { formKey: string; fieldId: string }; Body: { hidden?: boolean } }>(
    "/tenant/forms/:formKey/fields/:fieldId/visibility",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("forms.manage.tenant")] },
    async (request, reply) => {
      const { formKey, fieldId } = request.params;
      const hidden = !!request.body?.hidden;
      const tenantId = request.user!.tenantId;

      const [definition] = await request.tenantDb.select({ id: formDefinitions.id }).from(formDefinitions).where(eq(formDefinitions.key, formKey));
      if (!definition) return reply.code(404).send({ success: false, message: "Unknown form type" });

      const [field] = await request.tenantDb.select().from(formFields).where(eq(formFields.id, fieldId));
      if (!field) return reply.code(404).send({ success: false, message: "Not found" });

      if (hidden) {
        try {
          assertFieldCanBeHidden(field);
        } catch (err) {
          if (err instanceof FieldCannotBeHiddenError) {
            return reply.code(403).send({ success: false, message: err.message });
          }
          throw err;
        }
      }

      const [existingOverride] = await request.tenantDb
        .select({ id: formFieldOrderOverrides.id })
        .from(formFieldOrderOverrides)
        .where(and(eq(formFieldOrderOverrides.tenantId, tenantId), eq(formFieldOrderOverrides.fieldId, fieldId)));

      if (existingOverride) {
        await request.tenantDb.update(formFieldOrderOverrides).set({ isHidden: hidden, updatedAt: new Date() }).where(eq(formFieldOrderOverrides.id, existingOverride.id));
      } else {
        await request.tenantDb.insert(formFieldOrderOverrides).values({
          tenantId,
          formDefinitionId: definition.id,
          fieldId,
          isHidden: hidden,
        });
      }

      return { success: true };
    },
  );

  // PATCH .../fields/:fieldId/help-text — a Tenant Admin's own wording for a system/platform
  // field's description/placeholder (spec follow-up: "even if they can't change labels"). Same
  // upsert-into-form_field_order_overrides shape as the visibility route above, extended with two
  // more override columns — never touches the shared field row itself, so this tenant's wording
  // never leaks to any other tenant. A tenant's *own* field is already editable directly via the
  // plain `PATCH /tenant/forms/:formKey/fields/:fieldId` above; this route exists for the
  // system/platform rows that route can never reach.
  fastify.patch<{ Params: { formKey: string; fieldId: string }; Body: { description?: string | null; placeholder?: string | null } }>(
    "/tenant/forms/:formKey/fields/:fieldId/help-text",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("forms.manage.tenant")] },
    async (request, reply) => {
      const { formKey, fieldId } = request.params;
      const tenantId = request.user!.tenantId;
      const body = request.body ?? {};

      const [definition] = await request.tenantDb.select({ id: formDefinitions.id }).from(formDefinitions).where(eq(formDefinitions.key, formKey));
      if (!definition) return reply.code(404).send({ success: false, message: "Unknown form type" });

      const [field] = await request.tenantDb.select({ id: formFields.id }).from(formFields).where(eq(formFields.id, fieldId));
      if (!field) return reply.code(404).send({ success: false, message: "Not found" });

      const [existingOverride] = await request.tenantDb
        .select({ id: formFieldOrderOverrides.id })
        .from(formFieldOrderOverrides)
        .where(and(eq(formFieldOrderOverrides.tenantId, tenantId), eq(formFieldOrderOverrides.fieldId, fieldId)));

      const values = {
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.placeholder !== undefined ? { placeholder: body.placeholder } : {}),
      };

      if (existingOverride) {
        await request.tenantDb.update(formFieldOrderOverrides).set({ ...values, updatedAt: new Date() }).where(eq(formFieldOrderOverrides.id, existingOverride.id));
      } else {
        await request.tenantDb.insert(formFieldOrderOverrides).values({ tenantId, formDefinitionId: definition.id, fieldId, ...values });
      }

      return { success: true };
    },
  );

  // PATCH .../cta — a Tenant Admin's own submit-button text/position for this form type (Form
  // Builder spec follow-up, extending the same idea as the help-text override above from field
  // level to form level). Upserts into `tenant_form_cta_overrides`, never touching the platform
  // version's own `form_versions.layout_config.cta` — `getEffectiveForm` prefers this override
  // when present, falling back to the platform's own CTA otherwise.
  fastify.patch<{ Params: { formKey: string }; Body: { label?: string | null; align?: "left" | "center" | "right" | "full" | null } }>(
    "/tenant/forms/:formKey/cta",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("forms.manage.tenant")] },
    async (request, reply) => {
      const { formKey } = request.params;
      const tenantId = request.user!.tenantId;
      const body = request.body ?? {};

      const [definition] = await request.tenantDb.select({ id: formDefinitions.id }).from(formDefinitions).where(eq(formDefinitions.key, formKey));
      if (!definition) return reply.code(404).send({ success: false, message: "Unknown form type" });

      const cta = { label: body.label ?? undefined, align: body.align ?? undefined };

      const [existing] = await request.tenantDb
        .select({ id: tenantFormCtaOverrides.id })
        .from(tenantFormCtaOverrides)
        .where(and(eq(tenantFormCtaOverrides.tenantId, tenantId), eq(tenantFormCtaOverrides.formDefinitionId, definition.id)));

      if (existing) {
        await request.tenantDb.update(tenantFormCtaOverrides).set({ cta, updatedAt: new Date() }).where(eq(tenantFormCtaOverrides.id, existing.id));
      } else {
        await request.tenantDb.insert(tenantFormCtaOverrides).values({ tenantId, formDefinitionId: definition.id, cta });
      }

      return { success: true };
    },
  );

  // Tenant-owned steps/sections (Form Builder spec follow-up: "the tenant can have sections and
  // steps too, it just only affects their tenant") — a genuine parallel structure to the
  // platform's own, never touching a shared row, never needing republish reconciliation (they
  // were never tied to a platform version to begin with). Deletion is deliberately conservative:
  // a step with sections, or a section with fields, must be emptied first — no silent cascade.
  fastify.post<{ Params: { formKey: string }; Body: { title?: string; description?: string } }>(
    "/tenant/forms/:formKey/steps",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("forms.manage.tenant")] },
    async (request, reply) => {
      const { formKey } = request.params;
      const title = request.body?.title?.trim();
      if (!title) return reply.code(400).send({ success: false, message: "title is required" });
      const tenantId = request.user!.tenantId;

      const [definition] = await request.tenantDb.select({ id: formDefinitions.id }).from(formDefinitions).where(eq(formDefinitions.key, formKey));
      if (!definition) return reply.code(404).send({ success: false, message: "Unknown form type" });

      const existing = await request.tenantDb
        .select({ displayOrder: formSteps.displayOrder })
        .from(formSteps)
        .where(and(eq(formSteps.tenantId, tenantId), eq(formSteps.formDefinitionId, definition.id)));
      const key = slugify(title) || `step_${existing.length + 1}`;
      const nextDisplayOrder = existing.reduce((max, s) => Math.max(max, s.displayOrder), -1) + 1;

      const [created] = await request.tenantDb
        .insert(formSteps)
        .values({ formDefinitionId: definition.id, tenantId, key, title, description: request.body?.description || null, displayOrder: nextDisplayOrder, isOptional: false })
        .returning();

      return reply.code(201).send({ success: true, data: created });
    },
  );

  fastify.patch<{ Params: { formKey: string; stepId: string }; Body: { title?: string; description?: string } }>(
    "/tenant/forms/:formKey/steps/:stepId",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("forms.manage.tenant")] },
    async (request, reply) => {
      const { stepId } = request.params;
      const tenantId = request.user!.tenantId;
      const body = request.body ?? {};

      const [existing] = await request.tenantDb.select({ id: formSteps.id }).from(formSteps).where(and(eq(formSteps.id, stepId), eq(formSteps.tenantId, tenantId)));
      if (!existing) return reply.code(404).send({ success: false, message: "Not found" });

      const [updated] = await request.tenantDb
        .update(formSteps)
        .set({
          ...(body.title !== undefined ? { title: body.title.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description || null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(formSteps.id, stepId))
        .returning();

      return { success: true, data: updated };
    },
  );

  fastify.delete<{ Params: { formKey: string; stepId: string } }>(
    "/tenant/forms/:formKey/steps/:stepId",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("forms.manage.tenant")] },
    async (request, reply) => {
      const { stepId } = request.params;
      const tenantId = request.user!.tenantId;

      const [existing] = await request.tenantDb.select({ id: formSteps.id }).from(formSteps).where(and(eq(formSteps.id, stepId), eq(formSteps.tenantId, tenantId)));
      if (!existing) return reply.code(404).send({ success: false, message: "Not found" });

      const [sectionInStep] = await request.tenantDb.select({ id: formSections.id }).from(formSections).where(eq(formSections.formStepId, stepId));
      if (sectionInStep) return reply.code(409).send({ success: false, message: "Delete this step's sections first" });

      await request.tenantDb.delete(formSteps).where(eq(formSteps.id, stepId));
      return { success: true };
    },
  );

  fastify.post<{ Params: { formKey: string }; Body: { title?: string; stepKey?: string | null } }>(
    "/tenant/forms/:formKey/sections",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("forms.manage.tenant")] },
    async (request, reply) => {
      const { formKey } = request.params;
      const title = request.body?.title?.trim();
      if (!title) return reply.code(400).send({ success: false, message: "title is required" });
      const tenantId = request.user!.tenantId;

      const [definition] = await request.tenantDb.select({ id: formDefinitions.id }).from(formDefinitions).where(eq(formDefinitions.key, formKey));
      if (!definition) return reply.code(404).send({ success: false, message: "Unknown form type" });

      let formStepId: string | null = null;
      const stepKey = request.body?.stepKey;
      if (stepKey) {
        // Deliberately scoped to this tenant's own steps only — a tenant section never nests
        // under a platform step, so its structure never depends on something only a Super Admin
        // controls.
        const [step] = await request.tenantDb
          .select({ id: formSteps.id })
          .from(formSteps)
          .where(and(eq(formSteps.tenantId, tenantId), eq(formSteps.formDefinitionId, definition.id), eq(formSteps.key, stepKey)));
        if (!step) return reply.code(400).send({ success: false, message: "Unknown step" });
        formStepId = step.id;
      }

      const existing = await request.tenantDb
        .select({ displayOrder: formSections.displayOrder })
        .from(formSections)
        .where(and(eq(formSections.tenantId, tenantId), eq(formSections.formDefinitionId, definition.id)));
      const key = slugify(title) || `section_${existing.length + 1}`;
      const nextDisplayOrder = existing.reduce((max, s) => Math.max(max, s.displayOrder), -1) + 1;

      const [created] = await request.tenantDb
        .insert(formSections)
        .values({ formDefinitionId: definition.id, tenantId, formStepId, key, title, displayOrder: nextDisplayOrder })
        .returning();

      return reply.code(201).send({ success: true, data: created });
    },
  );

  fastify.patch<{ Params: { formKey: string; sectionId: string }; Body: { title?: string; stepKey?: string | null } }>(
    "/tenant/forms/:formKey/sections/:sectionId",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("forms.manage.tenant")] },
    async (request, reply) => {
      const { formKey, sectionId } = request.params;
      const tenantId = request.user!.tenantId;
      const body = request.body ?? {};

      const [existing] = await request.tenantDb.select({ id: formSections.id }).from(formSections).where(and(eq(formSections.id, sectionId), eq(formSections.tenantId, tenantId)));
      if (!existing) return reply.code(404).send({ success: false, message: "Not found" });

      let formStepId: string | null | undefined = undefined;
      if (body.stepKey !== undefined) {
        if (body.stepKey === null) {
          formStepId = null;
        } else {
          const [definition] = await request.tenantDb.select({ id: formDefinitions.id }).from(formDefinitions).where(eq(formDefinitions.key, formKey));
          const [step] = definition
            ? await request.tenantDb
                .select({ id: formSteps.id })
                .from(formSteps)
                .where(and(eq(formSteps.tenantId, tenantId), eq(formSteps.formDefinitionId, definition.id), eq(formSteps.key, body.stepKey)))
            : [];
          if (!step) return reply.code(400).send({ success: false, message: "Unknown step" });
          formStepId = step.id;
        }
      }

      const [updated] = await request.tenantDb
        .update(formSections)
        .set({
          ...(body.title !== undefined ? { title: body.title.trim() } : {}),
          ...(formStepId !== undefined ? { formStepId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(formSections.id, sectionId))
        .returning();

      return { success: true, data: updated };
    },
  );

  fastify.delete<{ Params: { formKey: string; sectionId: string } }>(
    "/tenant/forms/:formKey/sections/:sectionId",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("forms.manage.tenant")] },
    async (request, reply) => {
      const { sectionId } = request.params;
      const tenantId = request.user!.tenantId;

      const [existing] = await request.tenantDb.select({ id: formSections.id }).from(formSections).where(and(eq(formSections.id, sectionId), eq(formSections.tenantId, tenantId)));
      if (!existing) return reply.code(404).send({ success: false, message: "Not found" });

      const [fieldInSection] = await request.tenantDb.select({ id: formFields.id }).from(formFields).where(and(eq(formFields.formSectionId, sectionId), sql`${formFields.archivedAt} IS NULL`));
      if (fieldInSection) return reply.code(409).send({ success: false, message: "Move or archive this section's fields first" });

      await request.tenantDb.delete(formSections).where(eq(formSections.id, sectionId));
      return { success: true };
    },
  );

  fastify.put<{ Params: { formKey: string }; Body: { fieldIds?: string[] } }>(
    "/tenant/forms/:formKey/fields/reorder",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("forms.manage.tenant")] },
    async (request, reply) => {
      const { formKey } = request.params;
      const ctx = { tenantId: request.user!.tenantId, userId: request.user!.id, db: request.tenantDb };
      const result = await FormService.reorderFields(ctx, formKey, request.body?.fieldIds ?? []);
      if (!result.ok) {
        return sendFormServiceError(reply, result.error);
      }
      const data = await getEffectiveForm(request.tenantDb, formKey, ctx.tenantId);
      return { success: true, data };
    },
  );
};

export default tenantFormBuilderRoutes;
