import type { ComponentType } from "react";
import type { FieldType } from "../types/field";
import type { FieldRendererProps } from "./field-renderer-props";
import { TextField } from "./TextField";
import { TextareaField } from "./TextareaField";
import { NumberField } from "./NumberField";
import { EmailField } from "./EmailField";
import { UrlField } from "./UrlField";
import { DateField } from "./DateField";
import { DateTimeField } from "./DateTimeField";
import { SelectField } from "./SelectField";
import { MultiSelectField } from "./MultiSelectField";
import { RadioField } from "./RadioField";
import { CheckboxField } from "./CheckboxField";
import { ToggleField } from "./ToggleField";
import { FileField } from "./FileField";
import { UserSelectField } from "./UserSelectField";

/** One built-in component per `FieldType` (spec FR-012/FR-027) — `FormRenderer`'s type switch,
 * kept as a plain lookup table rather than a JSX switch statement so it stays a single place to
 * extend when a new field type is added. */
export const FIELD_TYPE_COMPONENTS: Record<FieldType, ComponentType<FieldRendererProps>> = {
  text: TextField,
  textarea: TextareaField,
  number: NumberField,
  email: EmailField,
  url: UrlField,
  date: DateField,
  datetime: DateTimeField,
  select: SelectField,
  multiselect: MultiSelectField,
  radio: RadioField,
  checkbox: CheckboxField,
  toggle: ToggleField,
  file: FileField,
  user_select: UserSelectField,
};

export type { FieldRendererProps } from "./field-renderer-props";
export { TextField } from "./TextField";
export { TextareaField } from "./TextareaField";
export { NumberField } from "./NumberField";
export { EmailField } from "./EmailField";
export { UrlField } from "./UrlField";
export { DateField } from "./DateField";
export { DateTimeField } from "./DateTimeField";
export { SelectField } from "./SelectField";
export { MultiSelectField } from "./MultiSelectField";
export { RadioField } from "./RadioField";
export { CheckboxField } from "./CheckboxField";
export { ToggleField } from "./ToggleField";
export { FileField } from "./FileField";
export { UserSelectField } from "./UserSelectField";
