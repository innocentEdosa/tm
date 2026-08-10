"use client";

import type { FieldRendererProps } from "./field-renderer-props";
import { fieldInputId } from "./field-renderer-props";

export function TextareaField({ field, value, onChange, error, readOnly }: FieldRendererProps) {
  const id = fieldInputId(field);
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {field.label}
        {field.isRequired ? " *" : ""}
      </label>
      {field.description && <p className="field-hint">{field.description}</p>}
      <textarea
        id={id}
        className="field-input"
        rows={3}
        placeholder={field.placeholder ?? undefined}
        disabled={readOnly}
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
