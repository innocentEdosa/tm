import { and, eq, isNull, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import { formDefinitions, formFields, formFieldOrderOverrides } from "../db/schema/custom-fields";
import type { FieldRow } from "./field-validation";

export interface MergedFieldRow {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: string;
  options: unknown;
  isRequired: boolean;
  displayOrder: number;
  scope: "system" | "global" | "tenant";
  isSystem: boolean;
}

/** The whole form's field layout — system (module-hardcoded) fields, global (Super Admin) fields,
 * and this tenant's own fields, as one flat, tenant-reorderable sequence (superseding this
 * framework's original "tenant fields only reorder among themselves" rule, per direct product
 * feedback). Effective order is each field's own seeded/default `displayOrder`, overridden by a
 * matching `form_field_order_overrides` row when the caller's own tenant has dragged it elsewhere
 * (RLS-scoped via `tenantDb` — that table only ever shows the caller's own overrides). A field's
 * `label`/`fieldType`/`isRequired`/`options` are never affected by an override, only its position —
 * and for `isSystem` rows those are nominal placeholders anyway (the consuming module always renders
 * its own real, hardcoded control, matched by `fieldKey`). */
export async function getFormFields(tenantDb: Db, formKey: string): Promise<MergedFieldRow[]> {
  const [definition] = await tenantDb
    .select({ id: formDefinitions.id })
    .from(formDefinitions)
    .where(eq(formDefinitions.key, formKey));
  if (!definition) {
    return [];
  }

  const rows = await tenantDb
    .select()
    .from(formFields)
    .where(and(eq(formFields.formDefinitionId, definition.id), isNull(formFields.archivedAt)));

  const overrides = await tenantDb
    .select({ fieldId: formFieldOrderOverrides.fieldId, displayOrder: formFieldOrderOverrides.displayOrder })
    .from(formFieldOrderOverrides)
    .where(eq(formFieldOrderOverrides.formDefinitionId, definition.id));
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

/** research.md §2 — the literal `(tenantId, formDefinitionId, fieldKey)` unique index does not by
 * itself catch a cross-scope collision (a tenant field vs. an existing global field), since Postgres
 * treats a NULL `tenantId` as a different value, not something that conflicts with a real tenant
 * UUID. Checks across *both* scopes (a tenant session's RLS-scoped view of `form_fields` is already
 * exactly "global rows ∪ this tenant's own rows" — data-model.md — so no explicit tenant filter is
 * needed here), including archived rows (an archived field's key isn't immediately reusable). */
export async function fieldKeyCollisionExists(
  tenantDb: Db,
  formDefinitionId: string,
  fieldKey: string,
  excludeFieldId?: string,
): Promise<boolean> {
  const conditions = [
    eq(formFields.formDefinitionId, formDefinitionId),
    eq(formFields.fieldKey, fieldKey),
  ];
  if (excludeFieldId) {
    conditions.push(ne(formFields.id, excludeFieldId));
  }
  const [existing] = await tenantDb
    .select({ id: formFields.id })
    .from(formFields)
    .where(and(...conditions));
  return !!existing;
}
