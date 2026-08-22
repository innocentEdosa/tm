"use client";

import type { FieldRendererProps } from "./field-renderer-props";
import { fieldInputId } from "./field-renderer-props";

/**
 * Fallback renderer for `entity_select` — a single dynamic entity reference (e.g. TNA's
 * "Business Objective") whose real, tenant-owned option list can't live in this field's own
 * static `options` (spec FR-029: the consuming feature supplies its own `fieldRenderers`
 * override that fetches the real list). This component only ever runs when no override is
 * registered for the field key — e.g. the Super Admin's Platform Forms preview — so it degrades
 * to a plain dropdown over whatever static `options` were configured, rather than rendering
 * nothing.
 */
export function EntitySelectField({ field, value, onChange, error, readOnly }: FieldRendererProps) {
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
        className={`field-input ${value ? "" : "text-slate-400"}`}
        disabled={readOnly}
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" disabled hidden>
          {field.placeholder || "Select an option"}
        </option>
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
