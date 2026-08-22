import type { formFields } from "../db/schema/custom-fields";

export type FieldRow = typeof formFields.$inferSelect;

/** The subset of a field definition `validateFieldValue` actually needs — satisfied structurally by
 * both the full DB row (`FieldRow`) and the merged/API field shape (`MergedFieldRow`). */
export interface ValidatableField {
  fieldKey: string;
  label: string;
  fieldType: string;
  options: unknown;
  validation: unknown;
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
    case "datetime":
    case "email":
    case "url":
      if (typeof value !== "string") {
        return { fieldKey: field.fieldKey, message: `${field.label} must be text` };
      }
      return null;
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) {
        return { fieldKey: field.fieldKey, message: `${field.label} must be a number` };
      }
      return null;
    case "select":
    case "radio": {
      const options = (field.options as string[] | null) ?? [];
      // "Allow custom options" bypass, same as `multiselect` above — extended to both
      // single-select shapes (`SelectField`'s dropdown, `RadioField`'s pills), each with its own
      // "+ Add custom" affordance: the respondent's typed-in value becomes the selection itself,
      // not an addition to a set.
      const allowCustom = !!(field.validation as { allowCustomOptions?: boolean } | null)?.allowCustomOptions;
      if (typeof value !== "string" || value.trim().length === 0 || !(allowCustom || options.includes(value))) {
        return { fieldKey: field.fieldKey, message: `${field.label} must be one of the configured options` };
      }
      return null;
    }
    case "multiselect": {
      const options = (field.options as string[] | null) ?? [];
      // "Allow custom options" (multiple form responses feature follow-up) — a respondent may add
      // their own entries alongside the configured presets (packages/form-builder's
      // `MultiSelectField`), so a value outside `options` is only invalid when the field wasn't
      // configured to allow that in the first place.
      const allowCustom = !!(field.validation as { allowCustomOptions?: boolean } | null)?.allowCustomOptions;
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string" && v.trim().length > 0 && (allowCustom || options.includes(v)))) {
        return { fieldKey: field.fieldKey, message: `${field.label} must be a set of the configured options` };
      }
      return null;
    }
    case "checkbox":
    case "toggle":
      if (typeof value !== "boolean") {
        return { fieldKey: field.fieldKey, message: `${field.label} is invalid` };
      }
      return null;
    case "file":
      // Never validated here — spec FR-031, the Form Builder never becomes the file storage
      // layer; a consumer wiring real upload/storage integration validates its own way.
      return null;
    case "user_select":
    case "entity_select":
      // Both trust the consuming feature's own custom `fieldRenderers` override to only ever send
      // a real id (spec FR-029) — no generic options-membership check, since the valid set is a
      // dynamic, tenant-owned list (users, business objectives, …), never this field's own static
      // `options`. `entity_select` is the same "single dynamic reference" contract as `user_select`,
      // just not hardcoded to users — e.g. TNA's "Business Objective" field.
      if (typeof value !== "string") {
        return { fieldKey: field.fieldKey, message: `${field.label} must be a valid selection` };
      }
      return null;
    case "people_select": {
      const isEntry = (v: unknown): v is { type: string; id: string } =>
        !!v && typeof v === "object" && (v as { type?: unknown }).type !== undefined && (v as { id?: unknown }).id !== undefined;
      if (
        !Array.isArray(value) ||
        !value.every((v) => isEntry(v) && (v.type === "user" || v.type === "role") && typeof v.id === "string" && v.id.length > 0)
      ) {
        return { fieldKey: field.fieldKey, message: `${field.label} must be a set of selected people or roles` };
      }
      return null;
    }
    default:
      return { fieldKey: field.fieldKey, message: `${field.label} has an unrecognized field type` };
  }
}
