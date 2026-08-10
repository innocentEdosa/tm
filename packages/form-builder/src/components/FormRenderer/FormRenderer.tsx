"use client";

import { forwardRef, useImperativeHandle, useMemo, useState, type ComponentType, type CSSProperties, type FormEvent } from "react";
import { Button } from "@tm/ui";
import type { EffectiveForm, FormField, FormSection } from "../../types/form";
import { FIELD_TYPE_COMPONENTS, type FieldRendererProps } from "../../fields";
import { validateFieldValue } from "./validate-field";

export interface FormRendererProps {
  form: EffectiveForm | null;
  values: Record<string, unknown>;
  onChange: (fieldKey: string, value: unknown) => void;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
  /** Server-side rejection errors, keyed by `fieldKey` — merged with client-side validation
   * (spec FR-027's "server-side validation errors" requirement). */
  errors?: Record<string, string>;
  isSubmitting?: boolean;
  /** Renders every field's value without inputs — used by "view" drawers and by the Form
   * Builder's own preview (spec FR-028, contracts/form-renderer-package.md). */
  readOnly?: boolean;
  /** Escape hatch (spec FR-029): a field key present here renders with this component instead
   * of the built-in one for its `fieldType` — e.g. Department's Manager person-picker. */
  fieldRenderers?: Record<string, ComponentType<FieldRendererProps>>;
  submitLabel?: string;
  /** Passed straight through to every field component as `FieldRendererProps.subdomain` — only
   * the rare field type that needs to call a tenant-scoped API itself (currently
   * `UserSelectField`) reads it; every other field ignores it entirely. */
  subdomain?: string;
  /** Suppresses the built-in step-nav/submit footer entirely — for a consumer that needs more
   * than one distinctly-validated action (e.g. Training Needs Analysis's "Save as draft", which
   * intentionally skips required-field validation, alongside "Submit", which doesn't). Such a
   * consumer supplies its own footer and drives submission via the `ref` handle instead. */
  hideActions?: boolean;
}

export interface FormRendererHandle {
  /** Runs the same required/type validation the built-in submit button would, without
   * submitting — lets a consumer with `hideActions` implement its own differently-validated
   * actions around the same rendered fields. Returns whether every field currently passes. */
  validate: () => boolean;
}

function allFields(form: EffectiveForm): FormField[] {
  return form.steps.flatMap((step) => step.sections.flatMap((section) => section.fields));
}

function ReadOnlyFieldValue({ field, value }: { field: FormField; value: unknown }) {
  const display = Array.isArray(value) ? value.join(", ") : ((value as string | number | boolean | undefined) ?? "");
  return (
    <div>
      <p className="field-label">{field.label}</p>
      {display === "" || display === undefined ? (
        <p className="text-sm italic text-slate-400">Not set</p>
      ) : (
        <p className="text-sm text-secondary">{String(display)}</p>
      )}
    </div>
  );
}

function FieldGrid({
  fields,
  values,
  onChange,
  errors,
  readOnly,
  fieldRenderers,
  subdomain,
}: {
  fields: FormField[];
  values: Record<string, unknown>;
  onChange: (fieldKey: string, value: unknown) => void;
  errors: Record<string, string>;
  readOnly: boolean;
  fieldRenderers: Record<string, ComponentType<FieldRendererProps>>;
  subdomain?: string;
}) {
  return (
    <div className="field-grid grid grid-cols-12 gap-4">
      {fields.map((field) => {
        // Full width below the container's own `field-grid` breakpoint (globals.css) regardless
        // of the authored `colSpan` — on a real phone, or a narrow window, a two-up column layout
        // just cramps every input; multi-column only kicks in once there's genuinely room for it.
        const style = { "--field-col-span": field.layout.colSpan } as CSSProperties;
        if (readOnly) {
          return (
            <div key={field.id} className="field-grid-item min-w-0" style={style}>
              <ReadOnlyFieldValue field={field} value={values[field.fieldKey]} />
            </div>
          );
        }
        const Component = fieldRenderers[field.fieldKey] ?? FIELD_TYPE_COMPONENTS[field.fieldType];
        return (
          <div key={field.id} className="field-grid-item min-w-0" style={style}>
            <Component
              field={field}
              value={values[field.fieldKey]}
              onChange={(value) => onChange(field.fieldKey, value)}
              error={errors[field.fieldKey]}
              readOnly={readOnly}
              subdomain={subdomain}
            />
          </div>
        );
      })}
    </div>
  );
}

function SectionBlock(props: {
  section: FormSection;
  values: Record<string, unknown>;
  onChange: (fieldKey: string, value: unknown) => void;
  errors: Record<string, string>;
  readOnly: boolean;
  fieldRenderers: Record<string, ComponentType<FieldRendererProps>>;
  subdomain?: string;
}) {
  const { section } = props;
  if (section.fields.length === 0) return null;
  return (
    <div className="space-y-4">
      {section.title && (
        <div>
          <h3 className="text-sm font-semibold text-primary">{section.title}</h3>
          {section.description && <p className="text-sm text-slate-500">{section.description}</p>}
        </div>
      )}
      <FieldGrid fields={section.fields} {...props} />
    </div>
  );
}

/**
 * The single shared form-rendering mechanism (spec FR-027/FR-028) — every consuming feature
 * page, the Super Admin builder's preview, and the Tenant Admin builder's preview all render
 * through this exact component. No consuming page implements its own field-type switch.
 */
export const FormRenderer = forwardRef<FormRendererHandle, FormRendererProps>(function FormRenderer(
  { form, values, onChange, onSubmit, errors: serverErrors, isSubmitting, readOnly, fieldRenderers = {}, submitLabel, hideActions, subdomain },
  ref,
) {
  const [stepIndex, setStepIndex] = useState(0);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  const mergedErrors = useMemo(() => ({ ...clientErrors, ...serverErrors }), [clientErrors, serverErrors]);

  function validateFields(fields: FormField[]): Record<string, string> {
    const errs: Record<string, string> = {};
    for (const field of fields) {
      const message = validateFieldValue(field, values[field.fieldKey]);
      if (message) errs[field.fieldKey] = message;
    }
    return errs;
  }

  useImperativeHandle(
    ref,
    () => ({
      validate: () => {
        if (!form) return true;
        const errs = validateFields(allFields(form));
        setClientErrors(errs);
        return Object.keys(errs).length === 0;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, values],
  );

  if (!form) return null;
  // Function declarations below close over `form` from this component's props scope, where TS
  // does not retain the `!form` narrowing above — rebind to a local `const` so it stays typed
  // as `EffectiveForm` (not `EffectiveForm | null`) throughout the rest of this render.
  const currentForm = form;

  const isWizard = currentForm.steps.length > 1;
  const currentStep = currentForm.steps[stepIndex] ?? currentForm.steps[0];

  function handleNext() {
    const stepFields = currentStep.sections.flatMap((s) => s.fields);
    const errs = validateFields(stepFields);
    if (Object.keys(errs).length > 0) {
      setClientErrors((prev) => ({ ...prev, ...errs }));
      return;
    }
    setStepIndex((i) => Math.min(i + 1, currentForm.steps.length - 1));
  }

  function handleBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (readOnly) return;
    const errs = validateFields(allFields(currentForm));
    setClientErrors(errs);
    if (Object.keys(errs).length > 0) return;
    await onSubmit(values);
  }

  const sectionsToRender = isWizard ? currentStep.sections : currentForm.steps.flatMap((s) => s.sections);

  // A consumer-supplied `submitLabel` (e.g. Department's dynamic "Create department" / "Save
  // changes") always wins — it reflects runtime state the Form Builder can't know about at
  // authoring time. Otherwise fall back to whatever the Form Builder configured for this version,
  // then a plain default.
  const effectiveSubmitLabel = submitLabel ?? currentForm.cta?.label ?? "Submit";
  const ctaAlign = currentForm.cta?.align ?? "right";
  const ctaJustifyClass = ctaAlign === "left" ? "justify-start" : ctaAlign === "center" ? "justify-center" : ctaAlign === "full" ? "" : "justify-end";

  return (
    <form className="space-y-6" onSubmit={readOnly ? (e) => e.preventDefault() : handleSubmit}>
      {isWizard && (
        <div className="flex items-center gap-2">
          {currentForm.steps.map((step, index) => (
            <div key={step.key} className="flex items-center gap-2">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                  index === stepIndex ? "bg-cta text-white" : index < stepIndex ? "bg-slate-200 text-slate-600" : "bg-slate-100 text-slate-400"
                }`}
              >
                {index + 1}
              </span>
              <span className={`text-sm ${index === stepIndex ? "font-medium text-primary" : "text-slate-500"}`}>{step.title}</span>
              {index < currentForm.steps.length - 1 && <span className="mx-1 h-px w-6 bg-slate-200" />}
            </div>
          ))}
        </div>
      )}

      {isWizard && currentStep.description && <p className="text-sm text-slate-500">{currentStep.description}</p>}

      <div className="space-y-6">
        {sectionsToRender.map((section) => (
          <SectionBlock
            key={section.key}
            section={section}
            values={values}
            onChange={onChange}
            errors={mergedErrors}
            readOnly={!!readOnly}
            fieldRenderers={fieldRenderers}
            subdomain={subdomain}
          />
        ))}
      </div>

      {!readOnly && !hideActions && (
        <div className={`flex items-center gap-3 ${ctaJustifyClass}`}>
          {isWizard && stepIndex > 0 && (
            <Button type="button" variant="secondary" onClick={handleBack}>
              Back
            </Button>
          )}
          {isWizard && stepIndex < currentForm.steps.length - 1 ? (
            <Button type="button" onClick={handleNext} className={ctaAlign === "full" ? "flex-1" : undefined}>
              Next
            </Button>
          ) : (
            <Button type="submit" isLoading={isSubmitting} className={ctaAlign === "full" ? "flex-1" : undefined}>
              {effectiveSubmitLabel}
            </Button>
          )}
        </div>
      )}
    </form>
  );
});
