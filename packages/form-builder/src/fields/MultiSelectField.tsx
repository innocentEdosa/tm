"use client";

import { useState } from "react";
import type { FieldRendererProps } from "./field-renderer-props";
import { fieldInputId } from "./field-renderer-props";
import { resolveFormIcon } from "../icons";

/** Same named palette `RadioField`'s `optionColors` draws from, applied to an option's icon
 * instead of a radio dot — `field.validation.optionIconColors` (option label → color name) is
 * purely presentational, entirely optional, and falls back to the brand `cta` color when unset
 * or unrecognized. */
const OPTION_ICON_COLORS = {
  danger: "text-red-500",
  warning: "text-orange-500",
  caution: "text-yellow-500",
  success: "text-green-500",
  info: "text-blue-500",
  purple: "text-purple-500",
  cyan: "text-cyan-500",
  pink: "text-pink-500",
  neutral: "text-slate-400",
} as const;
type OptionIconColor = keyof typeof OPTION_ICON_COLORS;

/**
 * `field.validation.allowCustomOptions` (multiple form responses feature follow-up, e.g. TNA's
 * "Type of Gap") lets a respondent add their own entry alongside the configured presets — the
 * added value is only ever appended to *this response's* selected values, never written back
 * into the shared field definition's own `options`, so one respondent's custom entry never
 * appears as a preset for anyone else. `field.validation.optionIcons` (option label → icon name
 * from `../icons`) is purely presentational, entirely optional.
 */
export function MultiSelectField({ field, value, onChange, error, readOnly }: FieldRendererProps) {
  const id = fieldInputId(field);
  const selected = (value as string[] | undefined) ?? [];
  const config =
    (field.validation as { allowCustomOptions?: boolean; optionIcons?: Record<string, string>; optionIconColors?: Record<string, OptionIconColor> } | null) ?? {};
  const allowCustomOptions = !!config.allowCustomOptions;
  const optionIcons = config.optionIcons ?? {};
  const optionIconColors = config.optionIconColors ?? {};
  const [customValue, setCustomValue] = useState("");

  // A previously-added custom value (e.g. loaded from an existing response) still needs a card
  // to render as checked/removable even though it isn't in `field.options`.
  const allOptions = [...(field.options ?? []), ...selected.filter((v) => !(field.options ?? []).includes(v))];

  function toggle(option: string) {
    onChange(selected.includes(option) ? selected.filter((v) => v !== option) : [...selected, option]);
  }

  function addCustom() {
    const trimmed = customValue.trim();
    if (!trimmed || selected.includes(trimmed)) {
      setCustomValue("");
      return;
    }
    onChange([...selected, trimmed]);
    setCustomValue("");
  }

  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {field.label}
        {field.isRequired ? " *" : ""}
      </label>
      {field.description && <p className="field-hint">{field.description}</p>}
      <div id={id} className="flex flex-wrap gap-2">
        {allOptions.map((option) => {
          const Icon = resolveFormIcon(optionIcons[option]);
          const iconColor = OPTION_ICON_COLORS[optionIconColors[option] ?? "neutral"] ?? OPTION_ICON_COLORS.neutral;
          const checked = selected.includes(option);
          return (
            <label
              key={option}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3.5 py-2 text-sm transition-colors ${
                checked ? "border-cta/40 bg-cta/5" : "border-border bg-white hover:bg-slate-50"
              } ${readOnly ? "cursor-default" : ""}`}
            >
              {Icon && <Icon className={`h-4 w-4 ${optionIconColors[option] ? iconColor : "text-cta"}`} />}
              <span className="text-primary">{option}</span>
              <input type="checkbox" checked={checked} disabled={readOnly} onChange={() => toggle(option)} className="h-4 w-4 rounded border-border" />
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
        {allOptions.length === 0 && !allowCustomOptions && <p className="text-sm text-slate-400">No options configured.</p>}
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
