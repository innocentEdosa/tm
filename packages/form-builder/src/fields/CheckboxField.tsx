"use client";

import type { FieldRendererProps } from "./field-renderer-props";
import { fieldInputId } from "./field-renderer-props";

export function CheckboxField({ field, value, onChange, error, readOnly }: FieldRendererProps) {
  const id = fieldInputId(field);
  return (
    <div>
      <label className="flex items-center gap-2 text-sm text-secondary" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          disabled={readOnly}
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
        {field.label}
        {field.isRequired ? " *" : ""}
      </label>
      {field.description && !error && <p className="field-hint">{field.description}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
