import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { formDefinitions, formFields, customFieldValues } from "../db/schema/custom-fields";
import { getFormFieldsForTenant } from "./tenant-scoped-form-fields";
import type { MergedFieldRow } from "../custom-fields/field-key-uniqueness";

export interface FormDefinitionRow {
  key: string;
  name: string;
  description: string;
}

/**
 * Backs the console's Forms tab (spec FR-008) form-type selector. `form_definitions` carries no
 * `tenant_id` and no RLS (platform-global catalog registered only via code/deployment, Spec 010
 * FR-001) — identical for every tenant.
 */
export async function getFormDefinitions(db: Db): Promise<FormDefinitionRow[]> {
  return db
    .select({ key: formDefinitions.key, name: formDefinitions.name, description: formDefinitions.description })
    .from(formDefinitions);
}

/**
 * Backs the console's Forms tab field list — the same tenant-scoped merge
 * (`getFormFieldsForTenant`, research.md §1) the create/edit handlers already use, exposed read-only
 * here for display.
 */
export async function getTenantCustomFields(
  db: Db,
  params: { tenantId: string; formKey: string },
): Promise<MergedFieldRow[]> {
  return getFormFieldsForTenant(db, params.tenantId, params.formKey);
}

/**
 * Backs the console's member Edit modal — the member's currently stored custom field values for the
 * "member" form, keyed by field key. Mirrors `GET /tenant/custom-field-values`'s response shape.
 */
export async function getMemberCustomFieldValues(
  db: Db,
  params: { entityId: string },
): Promise<Record<string, unknown>> {
  const [definition] = await db
    .select({ id: formDefinitions.id })
    .from(formDefinitions)
    .where(eq(formDefinitions.key, "member"));
  if (!definition) return {};
  const rows = await db
    .select({ fieldKey: formFields.fieldKey, value: customFieldValues.value })
    .from(customFieldValues)
    .innerJoin(formFields, eq(formFields.id, customFieldValues.fieldId))
    .where(
      and(eq(customFieldValues.formDefinitionId, definition.id), eq(customFieldValues.entityId, params.entityId)),
    );
  return Object.fromEntries(rows.map((r) => [r.fieldKey, r.value]));
}
