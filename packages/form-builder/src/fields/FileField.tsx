"use client";

import type { FieldRendererProps } from "./field-renderer-props";
import { fieldInputId } from "./field-renderer-props";

/** Generic fallback only — hands the browser's raw `File` to `onChange`. A form type whose
 * consuming feature has real upload/storage integration (presigned URLs, an attachments table,
 * etc.) is expected to supply its own component via `<FormRenderer fieldRenderers={{ [fieldKey]:
 * ... }}>` for this field key, the same escape hatch Department uses for its Manager
 * person-picker (spec FR-029) — the Form Builder itself never becomes responsible for file
 * storage (spec FR-031). */
export function FileField({ field, onChange, error, readOnly }: FieldRendererProps) {
  const id = fieldInputId(field);
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {field.label}
        {field.isRequired ? " *" : ""}
      </label>
      {field.description && <p className="field-hint">{field.description}</p>}
      <input
        id={id}
        type="file"
        className="field-input"
        disabled={readOnly}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
