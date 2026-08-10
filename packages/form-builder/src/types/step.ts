import type { FormSection } from "./section";

export interface FormStep {
  key: string;
  title: string;
  description: string | null;
  isOptional: boolean;
  sections: FormSection[];
}
