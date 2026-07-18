import { and, eq, isNull, ne, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { formDefinitions, formFields, formFieldOrderOverrides } from "../db/schema/custom-fields";
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
    .select({ id: formDefinitions.id })
    .from(formDefinitions)
    .where(eq(formDefinitions.key, formKey));
  if (!definition) {
    return [];
  }

  const rows = await db
    .select()
    .from(formFields)
    .where(
      and(
        eq(formFields.formDefinitionId, definition.id),
        isNull(formFields.archivedAt),
        or(isNull(formFields.tenantId), eq(formFields.tenantId, tenantId)),
      ),
    );

  const overrides = await db
    .select({ fieldId: formFieldOrderOverrides.fieldId, displayOrder: formFieldOrderOverrides.displayOrder })
    .from(formFieldOrderOverrides)
    .where(
      and(
        eq(formFieldOrderOverrides.formDefinitionId, definition.id),
        eq(formFieldOrderOverrides.tenantId, tenantId),
      ),
    );
  const overrideByFieldId = new Map(overrides.map((o) => [o.fieldId, o.displayOrder]));

  const scopeOf = (row: FieldRow): "system" | "global" | "tenant" => {
    if (row.isSystem) return "system";
    return row.tenantId === null ? "global" : "tenant";
  };

  const merged: MergedFieldRow[] = rows.map((row) => ({
    id: row.id,
    fieldKey: row.fieldKey,
    label: row.label,
    fieldType: row.fieldType,
    options: row.options,
    isRequired: row.isRequired,
    displayOrder: overrideByFieldId.get(row.id) ?? row.displayOrder,
    scope: scopeOf(row),
    isSystem: row.isSystem,
  }));

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
