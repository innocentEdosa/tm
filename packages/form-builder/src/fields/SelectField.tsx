"use client";

import type { FieldRendererProps } from "./field-renderer-props";
import { fieldInputId } from "./field-renderer-props";

export function SelectField({ field, value, onChange, error, readOnly }: FieldRendererProps) {
  const id = fieldInputId(field);
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
        disabled={readOnly}
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— Select —</option>
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
