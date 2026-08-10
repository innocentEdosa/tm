import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { formDefinitions, formFields, formFieldOrderOverrides } from "../db/schema/custom-fields";
import { formSteps, formSections } from "../db/schema/form-builder";
import type { FieldRow } from "../custom-fields/field-validation";
import type { MergedFieldRow } from "../custom-fields/field-key-uniqueness";

/**
 * Super Admin Edit Tenant Configuration spec (022), research.md §1 — a tenant-scoped equivalent of
 * `custom-fields/field-key-uniqueness.ts`'s `getFormFields`. The original relies on
 * `request.tenantDb`'s ambient RLS scoping (no `tenant_id` filter of its own — ties to a tenant
 * session's own RLS-scoped view, "global rows ∪ this tenant's own rows"); `request.superAdminDb` has
 * no such scoping, so every query here explicitly filters to `tenant_id IS NULL OR tenant_id = :id`,
 * never relying on RLS to narrow it. Used by both the member-edit surface (US1, member custom field
 * values) and the custom-field-definitions surface (US4, key-collision/edit checks).
 */
export async function getFormFieldsForTenant(
  db: Db,
  tenantId: string,
  formKey: string,
): Promise<MergedFieldRow[]> {
  const [definition] = await db
    .select({ id: formDefinitions.id, activeVersionId: formDefinitions.activeVersionId })
    .from(formDefinitions)
    .where(eq(formDefinitions.key, formKey));
  if (!definition) {
    return [];
  }

  // Same fix as `getFormFields` — a global/system field row exists once per version it's ever
  // belonged to, so this must scope to the active version only, not every row matching this
  // form_definition_id (which would duplicate every field once per archived version too).
  const activeVersionCondition = definition.activeVersionId ? eq(formFields.formVersionId, definition.activeVersionId) : sql`false`;
  const rows = await db
    .select()
    .from(formFields)
    .where(
      and(
        eq(formFields.formDefinitionId, definition.id),
        isNull(formFields.archivedAt),
        or(eq(formFields.tenantId, tenantId), activeVersionCondition),
      ),
    );

  // `db` here is `superAdminDb` — no RLS tenant-narrowing, so this tenant's own steps/sections
  // must be filtered explicitly, same as the overrides query above.
  const activeStepCondition = definition.activeVersionId ? eq(formSteps.formVersionId, definition.activeVersionId) : sql`false`;
  const steps = await db.select().from(formSteps).where(and(eq(formSteps.formDefinitionId, definition.id), or(eq(formSteps.tenantId, tenantId), activeStepCondition)));
  const activeSectionCondition = definition.activeVersionId ? eq(formSections.formVersionId, definition.activeVersionId) : sql`false`;
  const sections = await db
    .select()
    .from(formSections)
    .where(and(eq(formSections.formDefinitionId, definition.id), or(eq(formSections.tenantId, tenantId), activeSectionCondition)));
  const stepById = new Map(steps.map((s) => [s.id, s]));
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const fallbackSection = sections.find((s) => s.formStepId === null) ?? sections[0] ?? null;

  const overrides = await db
    .select({
      fieldId: formFieldOrderOverrides.fieldId,
      displayOrder: formFieldOrderOverrides.displayOrder,
      isHidden: formFieldOrderOverrides.isHidden,
      description: formFieldOrderOverrides.description,
      placeholder: formFieldOrderOverrides.placeholder,
    })
    .from(formFieldOrderOverrides)
    .where(
      and(
        eq(formFieldOrderOverrides.formDefinitionId, definition.id),
        eq(formFieldOrderOverrides.tenantId, tenantId),
      ),
    );
  const overrideByFieldId = new Map(overrides.map((o) => [o.fieldId, o]));

  const scopeOf = (row: FieldRow): "system" | "global" | "tenant" => {
    if (row.isSystem) return "system";
    return row.tenantId === null ? "global" : "tenant";
  };

  const merged: MergedFieldRow[] = rows.map((row) => {
    let sectionId = row.formSectionId;
    let needsReview = false;
    if (!sectionId || !sectionById.has(sectionId)) {
      sectionId = fallbackSection?.id ?? null;
      needsReview = row.tenantId !== null;
    }
    const section = sectionId ? (sectionById.get(sectionId) ?? null) : null;
    const step = section?.formStepId ? (stepById.get(section.formStepId) ?? null) : null;

    return {
      id: row.id,
      fieldKey: row.fieldKey,
      label: row.label,
      fieldType: row.fieldType,
      options: row.options,
      isRequired: row.isRequired,
      displayOrder: overrideByFieldId.get(row.id)?.displayOrder ?? row.displayOrder,
      scope: scopeOf(row),
      isSystem: row.isSystem,
      isHidden: overrideByFieldId.get(row.id)?.isHidden ?? false,
      description: overrideByFieldId.get(row.id)?.description ?? row.description,
      placeholder: overrideByFieldId.get(row.id)?.placeholder ?? row.placeholder,
      sectionKey: section?.key ?? null,
      sectionTitle: section?.title ?? null,
      stepKey: step?.key ?? null,
      stepTitle: step?.title ?? null,
      needsReview,
    };
  });

  merged.sort((a, b) => a.displayOrder - b.displayOrder);
  return merged;
}

/**
 * Tenant-scoped equivalent of `fieldKeyCollisionExists` (research.md §1) — checks a proposed field
 * key against the global field set and this tenant's own field set only, never another tenant's.
 */
export async function fieldKeyCollisionExistsForTenant(
  db: Db,
  tenantId: string,
  formDefinitionId: string,
  fieldKey: string,
  excludeFieldId?: string,
): Promise<boolean> {
  const conditions = [
    eq(formFields.formDefinitionId, formDefinitionId),
    eq(formFields.fieldKey, fieldKey),
    or(isNull(formFields.tenantId), eq(formFields.tenantId, tenantId))!,
  ];
  if (excludeFieldId) {
    conditions.push(ne(formFields.id, excludeFieldId));
  }
  const [existing] = await db
    .select({ id: formFields.id })
    .from(formFields)
    .where(and(...conditions));
  return !!existing;
}
