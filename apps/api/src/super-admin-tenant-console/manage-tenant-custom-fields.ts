import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { formDefinitions, formFields } from "../db/schema/custom-fields";
import { getFormFieldsForTenant, fieldKeyCollisionExistsForTenant } from "./tenant-scoped-form-fields";
import { slugify } from "../custom-fields/field-validation";
import { logTenantConfigAction } from "./tenant-config-action-log";
import { RecordNotFoundError, FieldKeyConflictError } from "./errors";

const FIELD_TYPES = ["text", "textarea", "number", "date", "select", "multiselect"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface CreateTenantCustomFieldInput {
  formKey?: string;
  label?: string;
  fieldKey?: string;
  fieldType?: FieldType;
  options?: string[];
  isRequired?: boolean;
}

export interface EditTenantCustomFieldInput {
  label?: string;
  fieldType?: FieldType;
  options?: string[];
  isRequired?: boolean;
  archived?: boolean;
}

export function isValidFieldType(fieldType: unknown): fieldType is FieldType {
  return typeof fieldType === "string" && (FIELD_TYPES as readonly string[]).includes(fieldType);
}

/**
 * contracts/super-admin-edit-tenant-config-api.md `POST /tenants/:id/custom-fields` (spec FR-008/
 * FR-009). Mirrors `POST /tenant/form-fields`'s (Spec 010) exact shape, explicitly scoped to
 * `tenantId` throughout (research.md §1/§2) — `tenant_id` is always set to the target tenant, never
 * `NULL`, and `createdBy` is always `"super_admin"`.
 */
export async function createTenantCustomField(
  db: Db,
  params: { tenantId: string; superAdminId: string; input: CreateTenantCustomFieldInput },
): Promise<{
  id: string;
  fieldKey: string;
  label: string;
  fieldType: FieldType;
  options: unknown;
  isRequired: boolean;
}> {
  const { tenantId, superAdminId, input } = params;

  const [definition] = await db
    .select({ id: formDefinitions.id })
    .from(formDefinitions)
    .where(eq(formDefinitions.key, input.formKey!));
  if (!definition) {
    throw new RecordNotFoundError(`Unknown form type ${input.formKey}`);
  }

  const fieldKey = input.fieldKey?.trim() || slugify(input.label!);
  if (await fieldKeyCollisionExistsForTenant(db, tenantId, definition.id, fieldKey)) {
    throw new FieldKeyConflictError(`Field key "${fieldKey}" already exists on this form`);
  }

  const existingFields = await getFormFieldsForTenant(db, tenantId, input.formKey!);
  const nextDisplayOrder = existingFields.reduce((max, f) => Math.max(max, f.displayOrder), -1) + 1;

  const [created] = await db
    .insert(formFields)
    .values({
      formDefinitionId: definition.id,
      tenantId,
      fieldKey,
      label: input.label!.trim(),
      fieldType: input.fieldType!,
      options: input.options ?? null,
      isRequired: !!input.isRequired,
      displayOrder: nextDisplayOrder,
      createdBy: "super_admin",
    })
    .returning();

  await logTenantConfigAction(db, {
    tenantId,
    superAdminId,
    entityType: "custom_field",
    entityId: created.id,
    action: "custom_field_created",
  });

  return {
    id: created.id,
    fieldKey: created.fieldKey,
    label: created.label,
    fieldType: created.fieldType as FieldType,
    options: created.options,
    isRequired: created.isRequired,
  };
}

/**
 * contracts/super-admin-edit-tenant-config-api.md `PATCH /tenants/:id/custom-fields/:fieldId` (spec
 * FR-008/FR-009). Mirrors `PATCH /tenant/form-fields/:fieldId`'s (Spec 010) exact shape. The
 * `and(eq(formFields.id, fieldId), eq(formFields.tenantId, tenantId))` filter is what makes a global
 * (`tenant_id IS NULL`) field resolve as not-found here — research.md §2, the load-bearing mechanism
 * since RLS alone (migration 0028) would otherwise permit reaching it.
 */
export async function editTenantCustomField(
  db: Db,
  params: { tenantId: string; fieldId: string; superAdminId: string; input: EditTenantCustomFieldInput },
): Promise<{
  id: string;
  fieldKey: string;
  label: string;
  fieldType: FieldType;
  options: unknown;
  isRequired: boolean;
  archived: boolean;
}> {
  const { tenantId, fieldId, superAdminId, input } = params;

  const [existing] = await db
    .select()
    .from(formFields)
    .where(and(eq(formFields.id, fieldId), eq(formFields.tenantId, tenantId)));
  if (!existing) {
    throw new RecordNotFoundError(`No custom field ${fieldId} for tenant ${tenantId}`);
  }

  const [updated] = await db
    .update(formFields)
    .set({
      ...(input.label !== undefined ? { label: input.label.trim() } : {}),
      ...(input.fieldType !== undefined ? { fieldType: input.fieldType } : {}),
      ...(input.options !== undefined ? { options: input.options } : {}),
      ...(input.isRequired !== undefined ? { isRequired: input.isRequired } : {}),
      ...(input.archived ? { archivedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(formFields.id, fieldId))
    .returning();

  await logTenantConfigAction(db, {
    tenantId,
    superAdminId,
    entityType: "custom_field",
    entityId: fieldId,
    action: input.archived ? "custom_field_archived" : "custom_field_edited",
  });

  return {
    id: updated.id,
    fieldKey: updated.fieldKey,
    label: updated.label,
    fieldType: updated.fieldType as FieldType,
    options: updated.options,
    isRequired: updated.isRequired,
    archived: updated.archivedAt !== null,
  };
}
