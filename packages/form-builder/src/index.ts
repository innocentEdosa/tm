// Public API only (contracts/form-renderer-package.md) — internal implementation files
// (components/, fields/, hooks/) are not meant to be imported directly by consumers.

export { FormRenderer } from "./components/FormRenderer/FormRenderer";
export type { FormRendererProps, FormRendererHandle } from "./components/FormRenderer/FormRenderer";
export { FormPreview } from "./components/FormPreview/FormPreview";
export { useEffectiveForm } from "./hooks/use-effective-form";
export type { FieldRendererProps } from "./fields";

export type { EffectiveForm, FormCta } from "./types/form";
export type { FormStep } from "./types/step";
export type { FormSection } from "./types/section";
export type { FormField, FieldType, FieldScope, FieldValidationConfig, FieldLayout } from "./types/field";
