import type { FormField } from "../types/field";

export interface FieldRendererProps {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  readOnly?: boolean;
  /** The tenant subdomain — threaded down from `<FormRenderer subdomain>` for the rare field
   * type (currently only `UserSelectField`) that needs to call a tenant-scoped API itself,
   * rather than just rendering/editing a value it's handed. Undefined outside a tenant context
   * (e.g. the Super Admin's Platform Forms preview, which has no specific tenant to search). */
  subdomain?: string;
}

export function fieldInputId(field: FormField): string {
  return `form-field-${field.fieldKey}`;
}
