export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "email"
  | "url"
  | "date"
  | "datetime"
  | "select"
  | "multiselect"
  | "radio"
  | "checkbox"
  | "toggle"
  | "file"
  | "user_select"
  | "people_select"
  | "entity_select";

export type FieldScope = "system" | "platform" | "tenant";

export interface FieldValidationConfig {
  min?: number;
  max?: number;
  pattern?: string;
  /** `multiselect` only — lets a respondent add their own entries alongside the configured
   * `options` presets, rather than being limited to exactly that list. */
  allowCustomOptions?: boolean;
}

/** One selected person or role — `people_select`'s stored value is an array of these. `label`
 * (and `sublabel`, a user's email) are display-only, resolved at selection time and never
 * re-resolved from `id` afterward — same "store the id, cache the display text" precedent
 * `UserSelectField` already established, so a later rename/deactivation can't desync anything
 * already saved. */
export interface PersonOrRoleSelection {
  type: "user" | "role";
  id: string;
  label: string;
  sublabel?: string;
}

export interface FieldLayout {
  /** 1-12, on a 12-column grid. Defaults to 12 (full width) when unset. */
  colSpan: number;
}

/**
 * Mirrors `apps/api/src/form-builder/get-effective-form.ts`'s `EffectiveFormField` exactly —
 * this package's types are not an independent source of truth for the wire shape
 * (contracts/form-renderer-package.md).
 */
export interface FormField {
  id: string;
  fieldKey: string;
  label: string;
  description: string | null;
  placeholder: string | null;
  fieldType: FieldType;
  options: string[] | null;
  defaultValue: unknown;
  validation: FieldValidationConfig | null;
  isRequired: boolean;
  displayOrder: number;
  layout: FieldLayout;
  scope: FieldScope;
  isSystem: boolean;
  needsReview: boolean;
}
