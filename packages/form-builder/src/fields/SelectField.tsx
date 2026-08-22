"use client";

import { useState } from "react";
import type { FieldRendererProps } from "./field-renderer-props";
import { fieldInputId } from "./field-renderer-props";

/** `field.validation.allowCustomOptions` — same capability `RadioField`/`MultiSelectField` already
 * have, extended to a plain single-select dropdown: a respondent can type their own value below
 * the select, which becomes the selection itself (single-choice, so "add" replaces, never appends
 * to a set). */
export function SelectField({ field, value, onChange, error, readOnly }: FieldRendererProps) {
  const id = fieldInputId(field);
  const allowCustomOptions = !!(field.validation as { allowCustomOptions?: boolean } | null)?.allowCustomOptions;
  const [customValue, setCustomValue] = useState("");

  // A previously-picked custom value (e.g. loaded from an existing response) still needs to
  // appear as the select's own current option, not just vanish because it isn't in the preset
  // list — same precedent `RadioField`'s own `allowCustomOptions` support already established.
  const presetOptions = field.options ?? [];
  const allOptions = typeof value === "string" && value && !presetOptions.includes(value) ? [...presetOptions, value] : presetOptions;

  function addCustom() {
    const trimmed = customValue.trim();
    if (!trimmed) return;
    onChange(trimmed);
    setCustomValue("");
  }

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
        {/* `disabled hidden` — a real placeholder, not a selectable "empty" choice: it disappears
            from the open dropdown's own option list once something else is picked, matching how
            an `<input placeholder>` behaves rather than reading as a genuine (blank) option. */}
        <option value="" disabled hidden>
          {field.placeholder || "Select an option"}
        </option>
        {allOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {allowCustomOptions && !readOnly && (
        <div className="mt-2 flex items-center gap-1 rounded-lg border border-dashed border-border px-2 py-1">
          <input
            type="text"
            className="w-full border-none bg-transparent px-1 py-1 text-sm text-primary placeholder:text-slate-400 focus:outline-none"
            placeholder="+ Add custom"
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
          />
          {customValue.trim() && (
            <button type="button" className="shrink-0 cursor-pointer text-xs font-medium text-cta hover:underline" onClick={addCustom}>
              Add
            </button>
          )}
        </div>
      )}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
