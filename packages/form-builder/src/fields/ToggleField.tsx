"use client";

import { Toggle } from "@tm/ui";
import type { FieldRendererProps } from "./field-renderer-props";

export function ToggleField({ field, value, onChange, readOnly }: FieldRendererProps) {
  return (
    <Toggle
      label={field.label}
      description={field.description ?? undefined}
      checked={!!value}
      onChange={onChange}
      disabled={readOnly}
    />
  );
}
