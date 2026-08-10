"use client";

// The submit-button (CTA) editor card — identical between the Platform and Tenant builders (only
// the save endpoint each page wires up differs). Renders nothing when closed — the "Edit CTA
// Button" trigger sits inline with "+ Add section"/"+ Add step" (`justify-between`), a layout
// this component can't own itself, so each caller renders its own trigger button and passes
// `onOpen`/`isOpen` through. Closes again on a successful save or the explicit close control.
import { AlignCenter, AlignLeft, AlignRight, StretchHorizontal, X } from "lucide-react";
import { Card, Button, Input } from "@tm/ui";
import type { FormCta } from "@tm/form-builder";

const ALIGN_OPTIONS = [
  { value: "left", label: "Left", Icon: AlignLeft },
  { value: "center", label: "Center", Icon: AlignCenter },
  { value: "right", label: "Right", Icon: AlignRight },
  { value: "full", label: "Full width", Icon: StretchHorizontal },
] as const;

export function CtaEditor({
  label,
  align,
  onLabelChange,
  onAlignChange,
  onSave,
  isSaving,
  error,
  isOpen,
  onOpen,
  onClose,
}: {
  label: string;
  align: NonNullable<FormCta["align"]>;
  onLabelChange: (value: string) => void;
  onAlignChange: (value: NonNullable<FormCta["align"]>) => void;
  onSave: () => void;
  isSaving: boolean;
  error: string | null;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  if (!isOpen) return null;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-primary">Submit button</p>
        <button
          type="button"
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-primary"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {error && <div className="banner-error mb-3">{error}</div>}
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Input label="Button text" placeholder="Submit" value={label} onChange={(e) => onLabelChange(e.target.value)} />
        </div>
        <div className="flex rounded-md border border-border p-0.5">
          {ALIGN_OPTIONS.map(({ value, label: optionLabel, Icon }) => (
            <button
              key={value}
              type="button"
              title={optionLabel}
              aria-label={optionLabel}
              onClick={() => onAlignChange(value)}
              className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded ${
                align === value ? "bg-slate-100 text-primary" : "text-slate-400 hover:text-slate-600"
              }`}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
        <Button variant="secondary" isLoading={isSaving} onClick={onSave}>
          Save
        </Button>
      </div>
    </Card>
  );
}
