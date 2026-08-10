"use client";

import { Input } from "@tm/ui";
import type { FieldRendererProps } from "./field-renderer-props";
import { fieldInputId } from "./field-renderer-props";

export function DateField({ field, value, onChange, error, readOnly }: FieldRendererProps) {
  return (
    <Input
      id={fieldInputId(field)}
      type="date"
      label={field.label}
      required={field.isRequired}
      hint={field.description ?? undefined}
      error={error}
      disabled={readOnly}
      value={(value as string) ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
