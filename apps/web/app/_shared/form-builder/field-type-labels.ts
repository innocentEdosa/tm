// Single source of truth for field-type display labels — previously duplicated between the
// Platform Forms builder and the Tenant Forms builder.
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

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Single-line text",
  textarea: "Multi-line text",
  number: "Number",
  email: "Email",
  url: "URL",
  date: "Date",
  datetime: "Date & time",
  select: "Single select",
  multiselect: "Multi-select",
  radio: "Radio",
  checkbox: "Checkbox",
  toggle: "Toggle",
  file: "File upload",
  user_select: "User (search & select)",
};
