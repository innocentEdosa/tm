export interface HideableField {
  isRequired: boolean;
}

export class FieldCannotBeHiddenError extends Error {}

/**
 * The single enforcement point for "a required field can never be hidden or removed by a Tenant
 * Admin, through any interaction path" (spec FR-022's required-field half — its system-field half
 * has been deliberately relaxed: a system field may be hidden once it's optional, same as any
 * platform field, since `is_system` only marks *ownership* of the field's definition, not whether
 * a value is mandatory — that's `is_required`, seeded to match the consuming feature's own actual
 * validation, e.g. Department's `manager_id`/`status` are optional system fields even though
 * `name` isn't (see `0036_seed_department_system_fields.sql`). Every route that can set
 * `form_field_order_overrides.is_hidden = true` MUST call this first, so there is exactly one
 * place this rule can be gotten wrong, not one per call site.
 */
export function assertFieldCanBeHidden(field: HideableField): void {
  if (field.isRequired) {
    throw new FieldCannotBeHiddenError("A required field can never be hidden.");
  }
}
