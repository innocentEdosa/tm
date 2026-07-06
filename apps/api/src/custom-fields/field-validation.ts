import type { formFields } from "../db/schema/custom-fields";

export type FieldRow = typeof formFields.$inferSelect;

/** The subset of a field definition `validateFieldValue` actually needs — satisfied structurally by
 * both the full DB row (`FieldRow`) and the merged/API field shape (`MergedFieldRow`). */
export interface ValidatableField {
  fieldKey: string;
  label: string;
  fieldType: string;
  options: unknown;
  isRequired: boolean;
}

/** Derives a suggested `field_key` from a label — lowercase, trim, collapse non-alphanumeric runs
 * to a single underscore, no leading/trailing underscore. No slug package needed (research.md §6). */
export function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export interface FieldValidationError {
  fieldKey: string;
  message: string;
}

/** Spec FR-007 — a submitted value must match its field's `fieldType` and `isRequired`. Returns
 * `null` when valid, else a per-field error. */
export function validateFieldValue(field: ValidatableField, value: unknown): FieldValidationError | null {
  const isEmpty = value === undefined || value === null || value === "";

  if (isEmpty) {
    if (field.isRequired) {
      return { fieldKey: field.fieldKey, message: `${field.label} is required` };
    }
    return null;
  }

  switch (field.fieldType) {
    case "text":
    case "textarea":
    case "date":
      if (typeof value !== "string") {
        return { fieldKey: field.fieldKey, message: `${field.label} must be text` };
      }
      return null;
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) {
        return { fieldKey: field.fieldKey, message: `${field.label} must be a number` };
      }
      return null;
    case "select": {
      const options = (field.options as string[] | null) ?? [];
      if (typeof value !== "string" || !options.includes(value)) {
        return { fieldKey: field.fieldKey, message: `${field.label} must be one of the configured options` };
      }
      return null;
    }
    case "multiselect": {
      const options = (field.options as string[] | null) ?? [];
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string" && options.includes(v))) {
        return { fieldKey: field.fieldKey, message: `${field.label} must be a set of the configured options` };
      }
      return null;
    }
    default:
      return { fieldKey: field.fieldKey, message: `${field.label} has an unrecognized field type` };
  }
}
