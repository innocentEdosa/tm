import type { FormStep } from "./step";

/** The resolved shape `useEffectiveForm`/`<FormRenderer>` consume — see
 * `apps/api/src/form-builder/get-effective-form.ts`'s `EffectiveForm` and
 * data-model.md's "Effective Form (resolved shape, not a table)". */
export interface FormCta {
  label?: string;
  align?: "left" | "center" | "right" | "full";
}

export interface EffectiveForm {
  formKey: string;
  formVersionId: string;
  steps: FormStep[];
  /** Submit-button text/position, set through the Form Builder — `<FormRenderer>` falls back to
   * a plain "Submit" (and right-aligned) when this, or a specific setting within it, is absent. */
  cta?: FormCta | null;
}

export * from "./field";
export * from "./section";
export * from "./step";
