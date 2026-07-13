"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, Plus, GripVertical } from "lucide-react";
import { PageHeader, Card, Badge, Drawer, Button, Input, Toggle } from "@tm/ui";

const API_BASE = "/tenant-api/tenant";

type FieldType = "text" | "textarea" | "number" | "date" | "select" | "multiselect";

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Single-line text",
  textarea: "Multi-line text",
  number: "Number",
  date: "Date",
  select: "Single select",
  multiselect: "Multi-select",
};

interface FormDefinition {
  id: string;
  key: string;
  name: string;
  description: string;
}

interface FieldRow {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: FieldType;
  options: string[] | null;
  isRequired: boolean;
  displayOrder: number;
  scope: "system" | "global" | "tenant";
  isSystem: boolean;
}

/** Cosmetic-only, purely for a nicer preview widget on known system fields (e.g. rendering Manager
 * as a person-search-styled box instead of a plain text input) — never affects position, ordering,
 * or which fields exist; that all comes from the backend now (`isSystem` rows in `form_fields`,
 * data-model.md). Safe to leave unmapped for any fieldKey — falls back to its own stored, nominal
 * `fieldType`. */
const SYSTEM_FIELD_PREVIEW_HINT: Record<string, "person"> = {
  manager_id: "person",
  assistant_manager_id: "person",
};

function PreviewInput({
  type,
  options,
}: {
  type: FieldType | "person";
  options?: string[] | null;
}) {
  switch (type) {
    case "textarea":
      return <textarea className="field-input" rows={2} disabled />;
    case "select":
      return (
        <select className="field-input" disabled defaultValue="">
          <option value="">— Select —</option>
          {(options ?? []).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
    case "multiselect":
      // A native `<select multiple disabled>` renders as a flat, unstyled list in every browser —
      // disabled state strips the selection highlighting that would normally distinguish options,
      // so it reads as a broken textarea rather than a form control. This preview never has a real
      // value to show anyway (it's the field *definition*, not a submitted answer), so the
      // configured options are shown as a chip list instead, matching the "Global" tag's styling.
      return (options ?? []).length > 0 ? (
        <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-slate-50 px-3 py-2.5">
          {(options ?? []).map((o) => (
            <span
              key={o}
              className="rounded-md border border-border bg-white px-2 py-0.5 text-xs text-slate-600"
            >
              {o}
            </span>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm italic text-slate-400">
          No options configured yet.
        </p>
      );
    case "number":
      return <input className="field-input" type="number" disabled placeholder="0" />;
    case "date":
      return <input className="field-input" type="date" disabled />;
    case "person":
      return <input className="field-input" disabled placeholder="Search by name or email…" />;
    case "text":
    default:
      return <input className="field-input" type="text" disabled />;
  }
}

function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

interface FieldFormState {
  label: string;
  fieldKey: string;
  fieldKeyTouched: boolean;
  fieldType: FieldType;
  options: string[];
  isRequired: boolean;
}

const EMPTY_FIELD_FORM: FieldFormState = {
  label: "",
  fieldKey: "",
  fieldKeyTouched: false,
  fieldType: "text",
  options: [],
  isRequired: false,
};

const ROW_ACTIONS_MENU_WIDTH = 140;
const ROW_ACTIONS_MENU_HEIGHT = 84;

function FieldRowActionsMenu({ onEdit, onArchive }: { onEdit: () => void; onArchive: () => void }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        buttonRef.current &&
        !buttonRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function toggleOpen() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const top =
        spaceBelow < ROW_ACTIONS_MENU_HEIGHT ? rect.top - ROW_ACTIONS_MENU_HEIGHT : rect.bottom + 4;
      const left = rect.right - ROW_ACTIONS_MENU_WIDTH;
      setPosition({ top, left });
    }
    setOpen((prev) => !prev);
  }

  return (
    <div data-row-actions>
      <button
        ref={buttonRef}
        type="button"
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-secondary hover:bg-slate-50 hover:text-primary"
        aria-label="Field actions"
        onClick={toggleOpen}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            data-row-actions
            style={{ top: position.top, left: position.left, width: ROW_ACTIONS_MENU_WIDTH }}
            className="fixed z-50 rounded-lg border border-border bg-white py-1 shadow-card-md"
          >
            <button
              type="button"
              className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-secondary hover:bg-slate-50 hover:text-primary"
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
            >
              Edit
            </button>
            <button
              type="button"
              className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
              onClick={() => {
                setOpen(false);
                onArchive();
              }}
            >
              Archive
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

export default function FormsSettingsClient({ subdomain }: { subdomain: string }) {
  const [definitions, setDefinitions] = useState<FormDefinition[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FieldFormState>(EMPTY_FIELD_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  async function loadDefinitions() {
    const res = await fetch(`${API_BASE}/form-definitions?subdomain=${encodeURIComponent(subdomain)}`, {
      credentials: "include",
    });
    if (res.status === 403) {
      setError("You don't have access to manage forms.");
      setDefinitions([]);
      return;
    }
    const json = (await res.json()) as { data: FormDefinition[] };
    setDefinitions(json.data);
    setError(null);
    if (json.data.length > 0 && !selectedKey) {
      setSelectedKey(json.data[0].key);
    }
  }

  async function loadFields(formKey: string) {
    const res = await fetch(
      `${API_BASE}/form-fields?formKey=${encodeURIComponent(formKey)}&subdomain=${encodeURIComponent(subdomain)}`,
      { credentials: "include" },
    );
    const json = (await res.json()) as { data: FieldRow[] };
    setFields(json.data);
  }

  useEffect(() => {
    loadDefinitions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedKey) {
      loadFields(selectedKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FIELD_FORM);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(field: FieldRow) {
    setEditingId(field.id);
    setForm({
      label: field.label,
      fieldKey: field.fieldKey,
      fieldKeyTouched: true,
      fieldType: field.fieldType,
      options: field.options ?? [],
      isRequired: field.isRequired,
    });
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!selectedKey) return;
    const trimmedLabel = form.label.trim();
    if (!trimmedLabel) {
      setFormError("Label is required.");
      return;
    }
    if ((form.fieldType === "select" || form.fieldType === "multiselect") && form.options.length === 0) {
      setFormError("Add at least one option for select/multiselect fields.");
      return;
    }
    const fieldKey = form.fieldKey.trim() || slugify(trimmedLabel);
    const collision = (fields ?? []).some((f) => f.id !== editingId && f.fieldKey === fieldKey);
    if (collision) {
      setFormError("A field with this key already exists on this form.");
      return;
    }

    setSaving(true);
    const body = editingId
      ? {
          label: trimmedLabel,
          fieldType: form.fieldType,
          options: form.options.length > 0 ? form.options : null,
          isRequired: form.isRequired,
        }
      : {
          formKey: selectedKey,
          label: trimmedLabel,
          fieldKey,
          fieldType: form.fieldType,
          options: form.options.length > 0 ? form.options : undefined,
          isRequired: form.isRequired,
        };
    const url = editingId
      ? `${API_BASE}/form-fields/${editingId}?subdomain=${encodeURIComponent(subdomain)}`
      : `${API_BASE}/form-fields?subdomain=${encodeURIComponent(subdomain)}`;
    const res = await fetch(url, {
      method: editingId ? "PATCH" : "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) {
      setFormOpen(false);
      loadFields(selectedKey);
      return;
    }
    const json = (await res.json().catch(() => null)) as { message?: string } | null;
    setFormError(json?.message ?? "Couldn't save this field. Try again.");
  }

  async function handleArchive(field: FieldRow) {
    if (!selectedKey) return;
    await fetch(`${API_BASE}/form-fields/${field.id}?subdomain=${encodeURIComponent(subdomain)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    loadFields(selectedKey);
  }

  /** The whole form's layout — system + global + tenant fields — reordered as one flat sequence
   * (superseding this framework's original "tenant fields only reorder among themselves" rule, per
   * direct product feedback). Sends the complete new order; the server upserts a position override
   * per field. */
  async function handleReorder(draggedId: string, targetIndex: number) {
    if (!selectedKey || !fields) return;
    const withoutDragged = fields.filter((f) => f.id !== draggedId);
    const reordered = [
      ...withoutDragged.slice(0, targetIndex),
      fields.find((f) => f.id === draggedId)!,
      ...withoutDragged.slice(targetIndex),
    ];
    setFields(reordered);
    await fetch(`${API_BASE}/form-fields/reorder?subdomain=${encodeURIComponent(subdomain)}`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ formKey: selectedKey, fieldIds: reordered.map((f) => f.id) }),
    });
    loadFields(selectedKey);
  }

  function addOption() {
    setForm((f) => ({ ...f, options: [...f.options, ""] }));
  }
  function updateOption(index: number, value: string) {
    setForm((f) => ({ ...f, options: f.options.map((o, i) => (i === index ? value : o)) }));
  }
  function removeOption(index: number) {
    setForm((f) => ({ ...f, options: f.options.filter((_, i) => i !== index) }));
  }

  const showOptions = form.fieldType === "select" || form.fieldType === "multiselect";

  return (
    <main className="px-8 py-8">
      <PageHeader title="Forms" subtitle="Configure custom fields for your organization's forms." />

      {error && <div className="banner-error mb-4">{error}</div>}

      <div className="grid grid-cols-[220px_1fr] gap-6">
        <Card className="p-2">
          {definitions === null ? (
            <div className="p-4 text-center text-sm text-slate-500">Loading…</div>
          ) : (
            <nav className="space-y-1">
              {definitions.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`block w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm ${
                    selectedKey === d.key
                      ? "bg-slate-100 font-medium text-primary"
                      : "text-secondary hover:bg-slate-50"
                  }`}
                  onClick={() => setSelectedKey(d.key)}
                >
                  {d.name}
                </button>
              ))}
            </nav>
          )}
        </Card>

        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-primary">
              {definitions?.find((d) => d.key === selectedKey)?.name ?? ""}
            </h2>
            <Button onClick={openCreate} disabled={!selectedKey}>
              <Plus className="h-4 w-4" />
              Add field
            </Button>
          </div>

          <p className="mb-3 text-sm text-slate-500">
            A live preview of this form exactly as it renders for anyone filling it out — disabled
            here, since this screen only configures the fields, it doesn&apos;t submit them. Drag any
            field, including the built-in ones, to reorder the whole form.
          </p>

          <Card className="p-0">
            {fields === null ? (
              <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
            ) : fields.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">No fields on this form.</div>
            ) : (
              <div className="space-y-5 p-6">
                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    draggable
                    onDragStart={(e) => {
                      // Some browsers refuse to complete a native HTML5 drag (silently no-op on
                      // drop) unless dragstart actually populates dataTransfer — a plain state
                      // update alone isn't enough to make the browser treat this as a valid drag.
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", field.id);
                      setDragId(field.id);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const draggedId = dragId ?? e.dataTransfer.getData("text/plain");
                      if (draggedId && draggedId !== field.id) {
                        handleReorder(draggedId, index);
                      }
                      setDragId(null);
                    }}
                    onDragEnd={() => setDragId(null)}
                    className={`flex items-start gap-3 rounded-lg ${dragId === field.id ? "opacity-40" : ""}`}
                  >
                    <GripVertical className="mt-8 h-4 w-4 shrink-0 cursor-grab text-slate-400" />
                    <div className="flex-1">
                      <div className="mb-1.5 flex items-center gap-2">
                        <p className="field-label mb-0">
                          {field.label}
                          {field.isRequired && " *"}
                        </p>
                        {field.scope === "global" && <Badge variant="neutral">Global</Badge>}
                      </div>
                      <PreviewInput
                        type={SYSTEM_FIELD_PREVIEW_HINT[field.fieldKey] ?? field.fieldType}
                        options={field.options}
                      />
                    </div>
                    <div className="w-8 shrink-0 pt-1">
                      {field.scope === "tenant" && (
                        <FieldRowActionsMenu onEdit={() => openEdit(field)} onArchive={() => handleArchive(field)} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <Drawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        side="right"
        title={editingId ? "Edit field" : "Add field"}
      >
        <form className="space-y-4" onSubmit={handleSubmit}>
          {formError && <div className="banner-error">{formError}</div>}
          <Input
            label="Label"
            required
            value={form.label}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                label: e.target.value,
                fieldKey: f.fieldKeyTouched ? f.fieldKey : slugify(e.target.value),
              }))
            }
          />
          {!editingId && (
            <Input
              label="Field key"
              value={form.fieldKey}
              onChange={(e) => setForm((f) => ({ ...f, fieldKey: e.target.value, fieldKeyTouched: true }))}
            />
          )}
          <div>
            <label className="field-label" htmlFor="fieldType">
              Field type
            </label>
            <select
              id="fieldType"
              className="field-input"
              value={form.fieldType}
              onChange={(e) => setForm((f) => ({ ...f, fieldType: e.target.value as FieldType }))}
            >
              {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {showOptions && (
            <div>
              <p className="field-label">Options</p>
              <div className="space-y-2">
                {form.options.map((option, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      className="field-input"
                      value={option}
                      onChange={(e) => updateOption(index, e.target.value)}
                    />
                    <button
                      type="button"
                      className="cursor-pointer text-sm text-red-600"
                      onClick={() => removeOption(index)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button type="button" className="text-sm font-medium text-cta hover:underline cursor-pointer" onClick={addOption}>
                  + Add option
                </button>
              </div>
            </div>
          )}
          <Toggle
            label="Required"
            checked={form.isRequired}
            onChange={(checked) => setForm((f) => ({ ...f, isRequired: checked }))}
          />
          <Button type="submit" isLoading={saving} className="w-full">
            {editingId ? "Save changes" : "Add field"}
          </Button>
        </form>
      </Drawer>
    </main>
  );
}
