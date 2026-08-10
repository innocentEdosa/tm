import type { FormField } from "./field";

export interface FormSection {
  key: string;
  title: string;
  description: string | null;
  fields: FormField[];
}
