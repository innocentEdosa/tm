"use client";

import { useState } from "react";
import type { FieldRendererProps } from "./field-renderer-props";
import { fieldInputId } from "./field-renderer-props";

/** A small named palette a field's `validation.optionColors` (option label → color name) can
 * draw from — e.g. a Priority field mapping "Critical"→"danger", "High"→"warning", etc.
 * Unmapped options (or no `optionColors` at all) fall back to "neutral", so a plain yes/no radio
 * with no color configured still renders as a sensible bordered pill, not an error. */
const OPTION_COLORS = {
  danger: { dot: "text-red-500", ring: "border-red-300 bg-red-50" },
  warning: { dot: "text-orange-500", ring: "border-orange-300 bg-orange-50" },
  caution: { dot: "text-yellow-500", ring: "border-yellow-300 bg-yellow-50" },
  success: { dot: "text-green-500", ring: "border-green-300 bg-green-50" },
  info: { dot: "text-blue-500", ring: "border-blue-300 bg-blue-50" },
  neutral: { dot: "text-slate-400", ring: "border-border bg-white" },
} as const;
type OptionColor = keyof typeof OPTION_COLORS;

export function RadioField({ field, value, onChange, error, readOnly }: FieldRendererProps) {
  const id = fieldInputId(field);
  const config = (field.validation as { optionColors?: Record<string, OptionColor>; allowCustomOptions?: boolean } | null) ?? {};
  const optionColors = config.optionColors ?? {};
  const allowCustomOptions = !!config.allowCustomOptions;
  const [customValue, setCustomValue] = useState("");

  // A previously-picked custom value (e.g. loaded from an existing response) still needs its own
  // pill to render as selected/re-selectable even though it isn't in `field.options` — same
  // "never drop a selection that no longer matches the preset list" precedent `MultiSelectField`
  // already established for its own custom entries.
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
      <p className="field-label">
        {field.label}
        {field.isRequired ? " *" : ""}
      </p>
      {field.description && <p className="field-hint">{field.description}</p>}
      <div className="flex flex-wrap gap-2">
        {allOptions.map((option) => {
          const colorName = optionColors[option] ?? "neutral";
          const colors = OPTION_COLORS[colorName] ?? OPTION_COLORS.neutral;
          const checked = value === option;
          return (
            <label
              key={option}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3.5 py-2 text-sm transition-colors ${
                checked ? colors.ring : "border-border bg-white hover:bg-slate-50"
              } ${readOnly ? "cursor-default" : ""}`}
            >
              <input
                type="radio"
                name={id}
                value={option}
                disabled={readOnly}
                checked={checked}
                onChange={() => onChange(option)}
                className="sr-only"
              />
              <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-current ${colors.dot}`}>
                {checked && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
              </span>
              <span className="text-primary">{option}</span>
            </label>
          );
        })}
        {allowCustomOptions && !readOnly && (
          <div className="flex items-center gap-1 rounded-lg border border-dashed border-border px-2 py-1">
            <input
              type="text"
              className="w-32 border-none bg-transparent px-1 py-1 text-sm text-primary placeholder:text-slate-400 focus:outline-none"
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
              <button type="button" className="cursor-pointer text-xs font-medium text-cta hover:underline" onClick={addCustom}>
                Add
              </button>
            )}
          </div>
        )}
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
