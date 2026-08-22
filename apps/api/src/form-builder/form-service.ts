import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { formDefinitions, formFields, formFieldOrderOverrides } from "../db/schema/custom-fields";
import { formSections } from "../db/schema/form-builder";
import { getFormFields, fieldKeyCollisionExists, type MergedFieldRow } from "../custom-fields/field-key-uniqueness";
import { slugify, validateFieldValue, type FieldValidationError } from "../custom-fields/field-validation";
import { getEffectiveForm as getEffectiveFormResolver, type EffectiveForm } from "./get-effective-form";

/**
 * The application-service boundary for the tenant-scoped side of the Form Builder (spec 033).
 * Extracted out of `tenant-form-builder-routes.ts`'s handlers with no behavior change (AI
 * Foundation Phase 1) — every method here is the exact logic those routes already ran inline,
 * moved so a second caller (the AI tool registry, `apps/api/src/ai/tools/forms.ts`) can invoke the
 * same operations a human triggers through the UI, through the same `request.tenantDb`/RLS path.
 * Does not cover `visibility`/`help-text`/`cta`/`sections`/`steps` — out of scope for the AI
 * Foundation's first slice (field CRUD + effective-form resolution only); those routes are
 * untouched and still own their logic inline, exactly as before.
 */

/** Never trust a tenantId a caller could have supplied — this always comes from the same
 * server-resolved session context every existing route already uses
 * (`request.user.tenantId`/`request.tenantDb`), never from tool/prompt/request-body input. */
export interface FormServiceContext {
  tenantId: string;
  userId: string;
  db: Db;
}

export const FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "email",
  "url",
  "date",
  "datetime",
  "select",
  "multiselect",
  "radio",
  "checkbox",
  "toggle",
  "file",
  "user_select",
  "people_select",
  "entity_select",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type FormServiceError =
  | { code: "not_found"; message: string }
  | { code: "conflict"; message: string }
  | { code: "invalid"; message: string };

export type FormServiceResult<T> = { ok: true; data: T } | { ok: false; error: FormServiceError };

function ok<T>(data: T): FormServiceResult<T> {
  return { ok: true, data };
}
function fail<T>(code: FormServiceError["code"], message: string): FormServiceResult<T> {
  return { ok: false, error: { code, message } };
}

export interface CreateFieldInput {
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

export interface UpdateFieldInput {
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
  sectionKey?: string;
}

export interface FieldSummary {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: string;
  scope: "tenant";
  isSystem: false;
}

/** Same section-resolution logic `tenant-form-builder-routes.ts`'s create/update handlers already
 * used inline — moved here unchanged so both the route and the service's own callers share one
 * implementation. Resolves a tenant field's placement to a real `form_sections.id`: the section
 * matching `sectionKey` if given and valid (searched across both the active platform version's own
 * sections and this tenant's own), otherwise the active version's first section with no parent step
 * (or simply its first section). */
export async function resolveSectionId(
  db: Db,
  tenantId: string,
  formDefinitionId: string,
  activeVersionId: string | null,
  sectionKey: string | undefined,
): Promise<string | null> {
  const platformSections = activeVersionId ? await db.select().from(formSections).where(eq(formSections.formVersionId, activeVersionId)) : [];
  const tenantSections = await db.select().from(formSections).where(and(eq(formSections.tenantId, tenantId), eq(formSections.formDefinitionId, formDefinitionId)));
  const allSections = [...platformSections, ...tenantSections];
  if (allSections.length === 0) return null;
  const matched = sectionKey ? allSections.find((s) => s.key === sectionKey) : undefined;
  const fallback = platformSections.find((s) => s.formStepId === null) ?? platformSections[0] ?? allSections[0];
  return (matched ?? fallback).id;
}

export const FormService = {
  /** Management-view read (spec FR-010's "the form's own permission gates the screen" precedent —
   * open to any authenticated tenant session, not `forms.manage.tenant`-gated). Mirrors
   * `GET /tenant/form-fields`: returns `[]` for both "form type doesn't exist" and "no fields yet",
   * exactly as that route always has — never a 404 here. */
  async listFields(ctx: FormServiceContext, formKey: string): Promise<FormServiceResult<MergedFieldRow[]>> {
    const fields = await getFormFields(ctx.db, formKey);
    return ok(fields);
  },

  /** Render-view read — the fully-merged steps/sections/fields/cta a real end-user form would
   * show this tenant right now (`getEffectiveForm`). `null` when the form type doesn't exist or
   * has never been published, exactly as that resolver already returns (spec Edge Cases). */
  async getEffectiveForm(ctx: FormServiceContext, formKey: string): Promise<FormServiceResult<EffectiveForm | null>> {
    const effective = await getEffectiveFormResolver(ctx.db, formKey, ctx.tenantId);
    return ok(effective);
  },

  /** Extracted verbatim from `POST /tenant/forms/:formKey/fields` (tenant-form-builder-routes.ts)
   * — same validation order, same collision check, same section/displayOrder resolution. */
  async createField(ctx: FormServiceContext, formKey: string, input: CreateFieldInput): Promise<FormServiceResult<FieldSummary>> {
    const { label, fieldType, options, isRequired } = input;
    if (!label?.trim() || !fieldType) {
      return fail("invalid", "label and fieldType are required");
    }
    if (!FIELD_TYPES.includes(fieldType)) {
      return fail("invalid", "Unrecognized fieldType");
    }
    if ((fieldType === "select" || fieldType === "multiselect" || fieldType === "radio") && (!options || options.length === 0)) {
      return fail("invalid", "options is required for select/multiselect/radio fields");
    }

    const [definition] = await ctx.db.select().from(formDefinitions).where(eq(formDefinitions.key, formKey));
    if (!definition) {
      return fail("not_found", "Unknown form type");
    }

    const fieldKey = input.fieldKey?.trim() || slugify(label);
    if (await fieldKeyCollisionExists(ctx.db, definition.id, fieldKey)) {
      return fail("conflict", "A field with this key already exists on this form");
    }

    const sectionKey = input.sectionKey;
    const formSectionId = await resolveSectionId(ctx.db, ctx.tenantId, definition.id, definition.activeVersionId, sectionKey);

    const effective = await getEffectiveFormResolver(ctx.db, formKey, ctx.tenantId);
    const targetSection = effective?.steps.flatMap((s) => s.sections).find((sec) => sec.key === sectionKey) ?? effective?.steps[0]?.sections[0];
    const nextDisplayOrder = (targetSection?.fields ?? []).reduce((max, f) => Math.max(max, f.displayOrder), -1) + 1;

    const [created] = await ctx.db
      .insert(formFields)
      .values({
        formDefinitionId: definition.id,
        tenantId: ctx.tenantId,
        formVersionId: null,
        formSectionId,
        fieldKey,
        label: label.trim(),
        description: input.description ?? null,
        placeholder: input.placeholder ?? null,
        fieldType,
        options: options ?? null,
        defaultValue: input.defaultValue ?? null,
        validation: input.validation ?? null,
        isRequired: !!isRequired,
        displayOrder: nextDisplayOrder,
        layout: input.layout ?? null,
        createdBy: "tenant_admin",
      })
      .returning();

    return ok({ id: created.id, fieldKey: created.fieldKey, label: created.label, fieldType: created.fieldType, scope: "tenant", isSystem: false });
  },

  /** Extracted verbatim from `PATCH /tenant/forms/:formKey/fields/:fieldId`. Only ever reaches a
   * tenant-owned row (the route's own `tenantId` scoping on the existence check), so a
   * system/platform field can never be edited through this path — same as before. */
  async updateField(ctx: FormServiceContext, formKey: string, fieldId: string, input: UpdateFieldInput): Promise<FormServiceResult<FieldSummary>> {
    const [existing] = await ctx.db.select().from(formFields).where(and(eq(formFields.id, fieldId), eq(formFields.tenantId, ctx.tenantId)));
    if (!existing) {
      return fail("not_found", "Not found");
    }

    if (input.fieldType && !FIELD_TYPES.includes(input.fieldType)) {
      return fail("invalid", "Unrecognized fieldType");
    }

    let formSectionId: string | undefined;
    if (input.sectionKey !== undefined) {
      const [definition] = await ctx.db.select().from(formDefinitions).where(eq(formDefinitions.id, existing.formDefinitionId));
      const resolved = definition ? await resolveSectionId(ctx.db, ctx.tenantId, definition.id, definition.activeVersionId, input.sectionKey) : null;
      if (!resolved) {
        return fail("invalid", "Unknown section");
      }
      formSectionId = resolved;
    }

    const [updated] = await ctx.db
      .update(formFields)
      .set({
        ...(input.label !== undefined ? { label: input.label.trim() } : {}),
        ...(input.fieldType !== undefined ? { fieldType: input.fieldType } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.placeholder !== undefined ? { placeholder: input.placeholder } : {}),
        ...(input.options !== undefined ? { options: input.options } : {}),
        ...(input.defaultValue !== undefined ? { defaultValue: input.defaultValue } : {}),
        ...(input.validation !== undefined ? { validation: input.validation } : {}),
        ...(input.isRequired !== undefined ? { isRequired: input.isRequired } : {}),
        ...(input.layout !== undefined ? { layout: input.layout } : {}),
        ...(formSectionId !== undefined ? { formSectionId } : {}),
        ...(input.archived ? { archivedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(formFields.id, fieldId))
      .returning();

    return ok({ id: updated.id, fieldKey: updated.fieldKey, label: updated.label, fieldType: updated.fieldType, scope: "tenant", isSystem: false });
  },

  /** A tenant field's own `archivedAt` is a plain `updateField({archived:true})` — no separate
   * DELETE route exists in this codebase for any form field, mirroring the documented
   * `0038_seed_granular_crud_permissions.sql` precedent (archive-via-PATCH, never a hard delete). */
  async archiveField(ctx: FormServiceContext, formKey: string, fieldId: string): Promise<FormServiceResult<FieldSummary>> {
    return this.updateField(ctx, formKey, fieldId, { archived: true });
  },

  /** Extracted verbatim from `PUT /tenant/forms/:formKey/fields/reorder`. Per-field upsert into
   * `form_field_order_overrides` — only ever this tenant's own override row, RLS-scoped. */
  async reorderFields(ctx: FormServiceContext, formKey: string, fieldIds: string[]): Promise<FormServiceResult<{ reordered: number }>> {
    if (!fieldIds || fieldIds.length === 0) {
      return fail("invalid", "fieldIds is required");
    }

    for (const [index, fieldId] of fieldIds.entries()) {
      const [existingOverride] = await ctx.db
        .select({ id: formFieldOrderOverrides.id })
        .from(formFieldOrderOverrides)
        .where(and(eq(formFieldOrderOverrides.tenantId, ctx.tenantId), eq(formFieldOrderOverrides.fieldId, fieldId)));
      if (existingOverride) {
        await ctx.db.update(formFieldOrderOverrides).set({ displayOrder: index, updatedAt: new Date() }).where(eq(formFieldOrderOverrides.id, existingOverride.id));
      } else {
        const [definition] = await ctx.db.select({ id: formDefinitions.id }).from(formDefinitions).where(eq(formDefinitions.key, formKey));
        if (!definition) continue;
        await ctx.db.insert(formFieldOrderOverrides).values({ tenantId: ctx.tenantId, formDefinitionId: definition.id, fieldId, displayOrder: index });
      }
    }

    return ok({ reordered: fieldIds.length });
  },

  /** Pure validation, no DB access beyond the caller's own already-fetched `fields` list (typically
   * from `listFields` above) — reuses `validateFieldValue` exactly as `save-values.ts` already
   * does for the human-facing entity-value-save path, so an AI-proposed set of values is checked
   * against the identical rules a real submission would be. */
  validateFieldValues(fields: MergedFieldRow[], values: Record<string, unknown>): FieldValidationError[] {
    const errors: FieldValidationError[] = [];
    for (const field of fields.filter((f) => !f.isSystem)) {
      const error = validateFieldValue(field, values[field.fieldKey]);
      if (error) errors.push(error);
    }
    return errors;
  },
};
