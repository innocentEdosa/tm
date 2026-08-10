"use client";

import { useState } from "react";
import { FormRenderer } from "../FormRenderer/FormRenderer";
import type { EffectiveForm } from "../../types/form";

function noop() {
  /* preview never persists a submission anywhere — it's ephemeral, in-memory only */
}

/**
 * Thin wrapper around `<FormRenderer>` (spec FR-028) — guarantees the Form Builder's own preview
 * (Super Admin authoring a platform version, Tenant Admin previewing their tenant's effective
 * form) renders through the exact same component tree, with the exact same real inputs, as
 * production consumption — not a second, parallel, text-only preview renderer. Values live in
 * local state here and go nowhere: typing into the preview shows real field behavior (including
 * step navigation and required-field validation) without ever calling a submit endpoint.
 */
export function FormPreview({ form, subdomain }: { form: EffectiveForm | null; subdomain?: string }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  function handleChange(fieldKey: string, value: unknown) {
    setValues((prev) => ({ ...prev, [fieldKey]: value }));
  }
  return <FormRenderer form={form} values={values} onChange={handleChange} onSubmit={noop} subdomain={subdomain} />;
}
