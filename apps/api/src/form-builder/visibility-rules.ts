export interface HideableField {
  isSystem: boolean;
  isRequired: boolean;
}

export class FieldCannotBeHiddenError extends Error {}

/**
 * Spec FR-021/FR-022 — the single enforcement point for "a required or system field can never
 * be hidden or removed by a Tenant Admin, through any interaction path." Every route that can
 * set `form_field_order_overrides.is_hidden = true` MUST call this first, so there is exactly
 * one place this rule can be gotten wrong, not one per call site.
 */
export function assertFieldCanBeHidden(field: HideableField): void {
  if (field.isSystem) {
    throw new FieldCannotBeHiddenError("A system field can never be hidden.");
  }
  if (field.isRequired) {
    throw new FieldCannotBeHiddenError("A required field can never be hidden.");
  }
}
