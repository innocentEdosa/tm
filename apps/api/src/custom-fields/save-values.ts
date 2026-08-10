import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { formDefinitions, customFieldValues } from "../db/schema/custom-fields";
import { validateFieldValue, type FieldValidationError } from "./field-validation";
import type { MergedFieldRow } from "./field-key-uniqueness";

export type SaveValuesResult = { errors: FieldValidationError[] } | { errors: null };

/** Spec FR-007, pure (no DB access) — validates every submitted value against the provided merged
 * `fields` list. Callers that write custom field values alongside another insert/update in the same
 * transaction (e.g. Department's routes, research.md §5) MUST call this *before* that other write,
 * not after — `apps/api/src/plugins/tenant-context.ts` commits the whole per-request transaction on
 * `onResponse` regardless of status code, so returning a 422 *after* an earlier write in the same
 * handler would still commit that earlier write. */
export function validateCustomFieldValues(
  values: Record<string, unknown>,
  fields: MergedFieldRow[],
): FieldValidationError[] {
  const errors: FieldValidationError[] = [];
  // System rows are placeholders for a module's own hardcoded fields (e.g. Department's Name) —
  // their values are saved through that module's own real columns, never through this generic
  // mechanism, so they never participate in custom-field validation/storage.
  for (const field of fields.filter((f) => !f.isSystem)) {
    const error = validateFieldValue(field, values[field.fieldKey]);
    if (error) {
      errors.push(error);
    }
  }
  return errors;
}

/** Upserts one `custom_field_values` row per submitted field — unique on `(tenantId, entityId,
 * fieldId)`, so resaving replaces rather than duplicates. Does NOT validate — call
 * `validateCustomFieldValues` first and only call this once that returns no errors. */
export async function writeCustomFieldValues(
  tenantDb: Db,
  tenantId: string,
  formKey: string,
  entityId: string,
  values: Record<string, unknown>,
  fields: MergedFieldRow[],
): Promise<void> {
  const fieldByKey = new Map(fields.filter((f) => !f.isSystem).map((f) => [f.fieldKey, f]));
  const submittedKeys = Object.keys(values).filter((key) => fieldByKey.has(key));
  if (submittedKeys.length === 0) {
    return;
  }

  const [definition] = await tenantDb
    .select({ id: formDefinitions.id, activeVersionId: formDefinitions.activeVersionId })
    .from(formDefinitions)
    .where(eq(formDefinitions.key, formKey));
  if (!definition) {
    return;
  }

  for (const key of submittedKeys) {
    const field = fieldByKey.get(key)!;
    const value = values[key];
    const [existing] = await tenantDb
      .select({ id: customFieldValues.id })
      .from(customFieldValues)
      .where(and(eq(customFieldValues.entityId, entityId), eq(customFieldValues.fieldId, field.id)));

    if (existing) {
      // Form Builder spec (033) FR-032 — re-saving refreshes `formVersionId` to whichever
      // version is active *now*, not the one active when this value was first captured; the
      // historical record is only meant to reflect the version active at each write's own time.
      await tenantDb
        .update(customFieldValues)
        .set({ value, formVersionId: definition.activeVersionId, updatedAt: new Date() })
        .where(eq(customFieldValues.id, existing.id));
    } else {
      await tenantDb.insert(customFieldValues).values({
        tenantId,
        formDefinitionId: definition.id,
        formVersionId: definition.activeVersionId,
        entityId,
        fieldId: field.id,
        value,
      });
    }
  }
}

/** Convenience wrapper for callers with no earlier write in the same transaction to protect (the
 * generic `PUT /tenant/custom-field-values` endpoint) — validates then writes in one call. */
export async function saveCustomFieldValues(
  tenantDb: Db,
  tenantId: string,
  formKey: string,
  entityId: string,
  values: Record<string, unknown>,
  fields: MergedFieldRow[],
): Promise<SaveValuesResult> {
  const errors = validateCustomFieldValues(values, fields);
  if (errors.length > 0) {
    return { errors };
  }
  await writeCustomFieldValues(tenantDb, tenantId, formKey, entityId, values, fields);
  return { errors: null };
}
