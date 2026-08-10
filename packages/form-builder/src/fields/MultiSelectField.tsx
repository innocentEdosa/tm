"use client";

import type { FieldRendererProps } from "./field-renderer-props";
import { fieldInputId } from "./field-renderer-props";

export function MultiSelectField({ field, value, onChange, error, readOnly }: FieldRendererProps) {
  const id = fieldInputId(field);
  const selected = (value as string[] | undefined) ?? [];
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {field.label}
        {field.isRequired ? " *" : ""}
      </label>
      {field.description && <p className="field-hint">{field.description}</p>}
      <select
        id={id}
        className="field-input"
        multiple
        disabled={readOnly}
        value={selected}
        onChange={(e) => onChange(Array.from(e.target.selectedOptions, (o) => o.value))}
      >
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
