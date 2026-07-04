import React from "react";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, description, disabled }: ToggleProps) {
  return (
    <label className="flex items-center justify-between gap-4 py-3">
      <span>
        <span className="block text-sm font-medium text-primary">{label}</span>
        {description && <span className="block text-sm text-slate-500">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        data-checked={checked}
        className="toggle-track"
        onClick={() => onChange(!checked)}
      >
        <span className="toggle-thumb" data-checked={checked} />
      </button>
    </label>
  );
}
