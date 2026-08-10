"use client";

import { Input } from "@tm/ui";
import type { FieldRendererProps } from "./field-renderer-props";
import { fieldInputId } from "./field-renderer-props";

export function NumberField({ field, value, onChange, error, readOnly }: FieldRendererProps) {
  const validation = field.validation ?? {};
  return (
    <Input
      id={fieldInputId(field)}
      type="number"
      label={field.label}
      required={field.isRequired}
      placeholder={field.placeholder ?? undefined}
      hint={field.description ?? undefined}
      error={error}
      disabled={readOnly}
      min={validation.min}
      max={validation.max}
      value={value === undefined || value === null ? "" : (value as number)}
      onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.valueAsNumber)}
    />
  );
}
