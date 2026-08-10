import type { FormField } from "../../types/field";

/** Client-side mirror of the server's `validateFieldValue` (`apps/api/src/custom-fields/field-validation.ts`)
 * — kept as a small, independent copy rather than a shared import because this package has no
 * dependency on the API app; the server remains the authoritative check (spec FR-030), this is
 * only for immediate UI feedback before submission. */
export function validateFieldValue(field: FormField, value: unknown): string | null {
  const isEmpty =
    value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

  if (isEmpty) {
    return field.isRequired ? `${field.label} is required` : null;
  }

  const validation = field.validation ?? {};

  switch (field.fieldType) {
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) return `${field.label} must be a number`;
      if (validation.min !== undefined && value < validation.min) return `${field.label} must be at least ${validation.min}`;
      if (validation.max !== undefined && value > validation.max) return `${field.label} must be at most ${validation.max}`;
      return null;
    }
    case "email":
      if (typeof value !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `${field.label} must be a valid email address`;
      return null;
    case "url":
      if (typeof value !== "string" || !/^https?:\/\/.+/i.test(value)) return `${field.label} must be a valid URL`;
      return null;
    case "select":
    case "radio":
      if (typeof value !== "string" || !(field.options ?? []).includes(value)) return `${field.label} must be one of the configured options`;
      return null;
    case "multiselect":
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string" && (field.options ?? []).includes(v)))
        return `${field.label} must be a set of the configured options`;
      return null;
    case "checkbox":
    case "toggle":
      if (typeof value !== "boolean") return `${field.label} is invalid`;
      return null;
    case "text":
    case "textarea":
    case "date":
    case "datetime":
      if (typeof value !== "string") return `${field.label} must be text`;
      if (validation.pattern && !new RegExp(validation.pattern).test(value)) return `${field.label} is not in the expected format`;
      return null;
    case "user_select":
      if (typeof value !== "string") return `${field.label} must be a valid selection`;
      return null;
    default:
      return null;
  }
}
