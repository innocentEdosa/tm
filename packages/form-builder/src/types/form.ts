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
  /** Form-level response policy (multiple form responses feature,
   * `form_definitions.allow_multiple_responses`) — `false` means a respondent may have at most
   * one response for this form type; a consuming page reads this to decide whether to offer an
   * "Add another response" action instead of only ever edit-in-place. Enforcement lives server-
   * side in the consuming feature's own write route, never in this package. */
  allowMultipleResponses: boolean;
}

export * from "./field";
export * from "./section";
export * from "./step";
