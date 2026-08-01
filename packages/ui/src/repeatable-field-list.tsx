"use client";

import { Plus, X } from "lucide-react";

export interface RepeatableFieldListProps {
  items: string[];
  onChange: (items: string[]) => void;
  /** Placeholder text for the item at this index, e.g. `(i) => \`Objective ${i + 1}\`` */
  itemPlaceholder: (index: number) => string;
  addLabel: string;
  /** Items below this index can't be removed (e.g. a stated minimum count). Default 0. */
  minItems?: number;
  readOnly?: boolean;
}

/**
 * A labeled, add/remove-able list of single-line text fields — the "Objective 1 / Objective 2 / + Add
 * Objective" pattern used by Course Objectives, and reusable anywhere else a screen needs an editable
 * list of short strings (requirements, FAQs, etc.).
 */
export function RepeatableFieldList({ items, onChange, itemPlaceholder, addLabel, minItems = 0, readOnly = false }: RepeatableFieldListProps) {
  function updateItem(index: number, value: string) {
    const next = [...items];
    next[index] = value;
    onChange(next);
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  function addItem() {
    onChange([...items, ""]);
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((value, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            className="field-input"
            placeholder={itemPlaceholder(index)}
            value={value}
            onChange={(e) => updateItem(index, e.target.value)}
            disabled={readOnly}
          />
          {!readOnly && index >= minItems && (
            <button
              type="button"
              aria-label={`Remove ${itemPlaceholder(index)}`}
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-secondary hover:bg-slate-100 hover:text-primary"
              onClick={() => removeItem(index)}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button
          type="button"
          className="flex w-fit cursor-pointer items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          onClick={addItem}
        >
          <Plus className="h-4 w-4" />
          {addLabel}
        </button>
      )}
    </div>
  );
}
