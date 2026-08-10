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
  | "user_select";

export type FieldScope = "system" | "platform" | "tenant";

export interface FieldValidationConfig {
  min?: number;
  max?: number;
  pattern?: string;
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
