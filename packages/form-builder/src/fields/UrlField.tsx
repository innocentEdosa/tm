"use client";

import { Input } from "@tm/ui";
import type { FieldRendererProps } from "./field-renderer-props";
import { fieldInputId } from "./field-renderer-props";

export function UrlField({ field, value, onChange, error, readOnly }: FieldRendererProps) {
  return (
    <Input
      id={fieldInputId(field)}
      type="url"
      label={field.label}
      required={field.isRequired}
      placeholder={field.placeholder ?? undefined}
      hint={field.description ?? undefined}
      error={error}
      disabled={readOnly}
      value={(value as string) ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
