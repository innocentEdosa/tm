"use client";

import type { FieldRendererProps } from "./field-renderer-props";
import { fieldInputId } from "./field-renderer-props";

export function RadioField({ field, value, onChange, error, readOnly }: FieldRendererProps) {
  const id = fieldInputId(field);
  return (
    <div>
      <p className="field-label">
        {field.label}
        {field.isRequired ? " *" : ""}
      </p>
      {field.description && <p className="field-hint">{field.description}</p>}
      <div className="space-y-2">
        {(field.options ?? []).map((option) => (
          <label key={option} className="flex items-center gap-2 text-sm text-secondary">
            <input
              type="radio"
              name={id}
              value={option}
              disabled={readOnly}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            {option}
          </label>
        ))}
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
