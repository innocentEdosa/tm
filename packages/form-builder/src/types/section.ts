import type { FormField } from "./field";

export interface FormSection {
  key: string;
  title: string;
  description: string | null;
  /** An icon name from `../icons`'s `FORM_ICONS` registry — optional, purely presentational. */
  icon: string | null;
  fields: FormField[];
}
