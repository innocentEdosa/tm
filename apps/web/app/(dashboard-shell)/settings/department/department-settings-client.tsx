"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, Plus } from "lucide-react";
import { PageHeader, Card, Badge, Modal, Drawer, Button, Input } from "@tm/ui";

const API_BASE = "/tenant-api/tenant";

// spec FR-006/FR-007/FR-015 — Extensible Custom Fields Framework. The framework now returns this
// form's ENTIRE layout — its own system fields (Name/Parent/Description/Status/Manager/Assistant
// Manager) interleaved with global/tenant custom fields, in one tenant-reorderable sequence
// (research.md §4) — this component never decides ordering, it only renders whichever real,
// hardcoded control matches a system row's `fieldKey`, or the generic custom-field control for
// everything else, in the order given.
type CustomFieldType = "text" | "textarea" | "number" | "date" | "select" | "multiselect";

interface CustomFieldDefinition {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: CustomFieldType;
  options: string[] | null;
  isRequired: boolean;
  scope: "system" | "global" | "tenant";
  isSystem: boolean;
}

interface UserRef {
  id: string;
  fullName: string;
}

interface DepartmentRow {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  parentDepartmentId: string | null;
  memberCount: number;
  hasChildren: boolean;
  manager: UserRef | null;
  assistantManager: UserRef | null;
}

interface UserSearchResult {
  id: string;
  fullName: string;
  email: string;
}

type DeleteBlock =
  | { reason: "has_members"; memberCount: number; message: string; membersListHref: string }
  | { reason: "has_children"; message: string };

function computeDepth(id: string, byId: Map<string, DepartmentRow>): number {
  let depth = 1;
  let current = byId.get(id);
  while (current?.parentDepartmentId) {
    depth++;
    current = byId.get(current.parentDepartmentId);
  }
  return depth;
}

function computeExcludedParentIds(all: DepartmentRow[], editingId: string | null): Set<string> {
  const excluded = new Set<string>();
  const byId = new Map(all.map((r) => [r.id, r]));

  if (editingId) {
    excluded.add(editingId);
    const stack = [editingId];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const row of all) {
        if (row.parentDepartmentId === current && !excluded.has(row.id)) {
          excluded.add(row.id);
          stack.push(row.id);
        }
      }
    }
  }

  for (const row of all) {
    if (computeDepth(row.id, byId) >= 3) {
      excluded.add(row.id);
    }
  }

  return excluded;
}

/** A read-only detail value that's empty reads as a deliberate, described absence ("No manager
 * assigned") rather than a bare "—" — the same descriptive-fallback treatment "Parent department"
 * already used, extended here to every other detail field instead of living as a one-off. */
function FieldValue({ value, placeholder }: { value: React.ReactNode; placeholder: string }) {
  if (value === null || value === undefined || value === "") {
    return <p className="text-sm italic text-slate-400">{placeholder}</p>;
  }
  return <p className="text-sm text-secondary">{value}</p>;
}

interface PersonPickerProps {
  label: string;
  subdomain: string;
  value: UserRef | null;
  onChange: (user: UserRef | null) => void;
  excludeUserId?: string;
}

function PersonPicker({ label, subdomain, value, onChange, excludeUserId }: PersonPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      const res = await fetch(
        `${API_BASE}/users?search=${encodeURIComponent(query)}&subdomain=${encodeURIComponent(subdomain)}`,
        { credentials: "include" },
      );
      if (!res.ok) return;
      const json = (await res.json()) as { data: UserSearchResult[] };
      setResults(json.data.filter((u) => u.id !== excludeUserId));
    }, 250);
    return () => clearTimeout(handle);
  }, [query, subdomain, excludeUserId]);

  return (
    <div>
      <p className="field-label">{label}</p>
      {value ? (
        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
          <span className="text-sm text-primary">{value.fullName}</span>
          <button
            type="button"
            className="text-xs font-medium text-slate-500 hover:text-primary cursor-pointer"
            onClick={() => onChange(null)}
          >
            Clear
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            className="field-input"
            placeholder="Search by name or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {results.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-white py-1 shadow-card-md">
              {results.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm text-secondary hover:bg-slate-50 cursor-pointer"
                  onClick={() => {
                    onChange({ id: u.id, fullName: u.fullName });
                    setQuery("");
                    setResults([]);
                  }}
                >
                  {u.fullName} <span className="text-slate-400">({u.email})</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface DepartmentFormState {
  name: string;
  parentDepartmentId: string;
  description: string;
  status: "active" | "archived";
  manager: UserRef | null;
  assistantManager: UserRef | null;
}

const EMPTY_FORM: DepartmentFormState = {
  name: "",
  parentDepartmentId: "",
  description: "",
  status: "active",
  manager: null,
  assistantManager: null,
};

interface RowActionsMenuProps {
  status: "active" | "archived";
  onEdit: () => void;
  onArchiveToggle: () => void;
  onDelete: () => void;
}

const ROW_ACTIONS_MENU_WIDTH = 160;
const ROW_ACTIONS_MENU_HEIGHT = 116;

function RowActionsMenu({ status, onEdit, onArchiveToggle, onDelete }: RowActionsMenuProps) {
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
      // Portaled to <body> so the Card's `overflow-hidden` (needed to round the table's corners)
      // never clips this menu — fixed-positioned from the trigger button's own rect, flipped
      // upward when there isn't room below the viewport.
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
        aria-label="Row actions"
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
              className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-secondary hover:bg-slate-50 hover:text-primary"
              onClick={() => {
                setOpen(false);
                onArchiveToggle();
              }}
            >
              {status === "active" ? "Archive" : "Unarchive"}
            </button>
            <div className="my-1 border-t border-border" />
            <button
              type="button"
              className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              Delete
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

export default function DepartmentSettingsClient({ subdomain }: { subdomain: string }) {
  const [departments, setDepartments] = useState<DepartmentRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DepartmentFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<DepartmentRow | null>(null);
  const [deleteBlock, setDeleteBlock] = useState<DeleteBlock | null>(null);

  const [viewTargetId, setViewTargetId] = useState<string | null>(null);

  // The whole form's layout (system + global + tenant fields, ordered) — fetched once, independent
  // of which drawer is open, since both the create/edit drawer AND the view drawer need it.
  const [layoutFields, setLayoutFields] = useState<CustomFieldDefinition[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});
  const [viewCustomFieldValues, setViewCustomFieldValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    fetch(`${API_BASE}/form-fields?formKey=department&subdomain=${encodeURIComponent(subdomain)}`, {
      credentials: "include",
    })
      .then((res) => res.json())
      .then((json: { data: CustomFieldDefinition[] }) => setLayoutFields(json.data))
      .catch(() => setLayoutFields([]));
  }, [subdomain]);

  useEffect(() => {
    if (!formOpen || !editingId) {
      setCustomFieldValues({});
      return;
    }
    fetch(
      `${API_BASE}/custom-field-values?formKey=department&entityId=${editingId}&subdomain=${encodeURIComponent(subdomain)}`,
      { credentials: "include" },
    )
      .then((res) => res.json())
      .then((json: { data: Record<string, unknown> }) => setCustomFieldValues(json.data))
      .catch(() => setCustomFieldValues({}));
  }, [formOpen, editingId, subdomain]);

  useEffect(() => {
    if (!viewTargetId) {
      setViewCustomFieldValues({});
      return;
    }
    fetch(
      `${API_BASE}/custom-field-values?formKey=department&entityId=${viewTargetId}&subdomain=${encodeURIComponent(subdomain)}`,
      { credentials: "include" },
    )
      .then((res) => res.json())
      .then((json: { data: Record<string, unknown> }) => setViewCustomFieldValues(json.data))
      .catch(() => setViewCustomFieldValues({}));
  }, [viewTargetId, subdomain]);

  const customFields = useMemo(() => layoutFields.filter((f) => !f.isSystem), [layoutFields]);

  function validateCustomFields(): boolean {
    const errors: Record<string, string> = {};
    for (const field of customFields) {
      const value = customFieldValues[field.fieldKey];
      const isEmpty = value === undefined || value === null || value === "";
      if (isEmpty) {
        if (field.isRequired) {
          errors[field.fieldKey] = `${field.label} is required`;
        }
        continue;
      }
      if (field.fieldType === "number" && typeof value !== "number") {
        errors[field.fieldKey] = `${field.label} must be a number`;
      }
    }
    setCustomFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function load(searchTerm?: string) {
    const qs = new URLSearchParams({ subdomain });
    if (searchTerm) qs.set("search", searchTerm);
    const res = await fetch(`${API_BASE}/departments?${qs.toString()}`, { credentials: "include" });
    if (res.status === 403) {
      setError("You don't have access to view departments.");
      setDepartments([]);
      return;
    }
    const json = (await res.json()) as { data: DepartmentRow[] };
    setDepartments(json.data);
    setError(null);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => load(search), 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const byId = useMemo(() => new Map((departments ?? []).map((d) => [d.id, d])), [departments]);
  const viewTarget = viewTargetId ? (byId.get(viewTargetId) ?? null) : null;
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, DepartmentRow[]>();
    for (const dept of departments ?? []) {
      const key = dept.parentDepartmentId;
      const list = map.get(key) ?? [];
      list.push(dept);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  }, [departments]);

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  }

  function openView(dept: DepartmentRow) {
    setViewTargetId(dept.id);
  }

  function openEdit(dept: DepartmentRow) {
    setEditingId(dept.id);
    setForm({
      name: dept.name,
      parentDepartmentId: dept.parentDepartmentId ?? "",
      description: dept.description ?? "",
      status: dept.status,
      manager: dept.manager,
      assistantManager: dept.assistantManager,
    });
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setFormError("Name is required.");
      return;
    }
    const isDuplicate = (departments ?? []).some(
      (d) => d.id !== editingId && d.name.toLowerCase() === trimmedName.toLowerCase(),
    );
    if (isDuplicate) {
      setFormError("A department with this name already exists.");
      return;
    }
    if (form.manager && form.assistantManager && form.manager.id === form.assistantManager.id) {
      setFormError("Manager and Assistant Manager must be different people.");
      return;
    }
    if (!validateCustomFields()) {
      return;
    }
    setSaving(true);
    const body = {
      name: form.name.trim(),
      parentDepartmentId: form.parentDepartmentId || null,
      description: form.description || undefined,
      ...(editingId ? { status: form.status } : {}),
      managerId: form.manager?.id ?? null,
      assistantManagerId: form.assistantManager?.id ?? null,
      customFieldValues,
    };
    const url = editingId
      ? `${API_BASE}/departments/${editingId}?subdomain=${encodeURIComponent(subdomain)}`
      : `${API_BASE}/departments?subdomain=${encodeURIComponent(subdomain)}`;
    const res = await fetch(url, {
      method: editingId ? "PATCH" : "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) {
      setFormOpen(false);
      load(search);
      return;
    }
    const json = (await res.json().catch(() => null)) as
      | { message?: string; errors?: { fieldKey: string; message: string }[] }
      | null;
    if (json?.errors) {
      setCustomFieldErrors(Object.fromEntries(json.errors.map((e) => [e.fieldKey, e.message])));
      setFormError("Some custom fields need attention.");
      return;
    }
    setFormError(json?.message ?? "Couldn't save this department. Try again.");
  }

  async function handleArchiveToggle(dept: DepartmentRow) {
    const nextStatus = dept.status === "active" ? "archived" : "active";
    await fetch(`${API_BASE}/departments/${dept.id}?subdomain=${encodeURIComponent(subdomain)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    load(search);
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    const res = await fetch(
      `${API_BASE}/departments/${deleteTarget.id}?subdomain=${encodeURIComponent(subdomain)}`,
      { method: "DELETE", credentials: "include" },
    );
    if (res.status === 409) {
      const json = (await res.json()) as DeleteBlock;
      setDeleteBlock(json);
      return;
    }
    setDeleteTarget(null);
    setDeleteBlock(null);
    load(search);
  }

  const excludedParentIds = useMemo(
    () => computeExcludedParentIds(departments ?? [], editingId),
    [departments, editingId],
  );

  /** Department's own real, hardcoded controls — one per system field the framework's layout
   * places, matched by `fieldKey` (research.md §4). The framework decides *where* these sit
   * relative to global/tenant custom fields; this component still owns *how* each one actually
   * renders, validates, and saves (via `form.*` state, never `customFieldValues`). */
  function renderSystemField(field: CustomFieldDefinition): React.ReactNode {
    switch (field.fieldKey) {
      case "name":
        return (
          <Input
            key={field.id}
            label="Name"
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        );
      case "parent_department_id":
        return (
          <div key={field.id}>
            <label className="field-label" htmlFor="parentDepartmentId">
              Parent department
            </label>
            <select
              id="parentDepartmentId"
              className="field-input"
              value={form.parentDepartmentId}
              onChange={(e) => setForm((f) => ({ ...f, parentDepartmentId: e.target.value }))}
            >
              <option value="">— None (top-level) —</option>
              {(departments ?? [])
                .filter((d) => !excludedParentIds.has(d.id))
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
          </div>
        );
      case "description":
        return (
          <div key={field.id}>
            <label className="field-label" htmlFor="description">
              Description
            </label>
            <textarea
              id="description"
              className="field-input"
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
        );
      case "status":
        if (!editingId) return null;
        return (
          <div key={field.id}>
            <label className="field-label" htmlFor="status">
              Status
            </label>
            <select
              id="status"
              className="field-input"
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as "active" | "archived" }))}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        );
      case "manager_id":
        return (
          <PersonPicker
            key={field.id}
            label="Manager"
            subdomain={subdomain}
            value={form.manager}
            onChange={(u) => setForm((f) => ({ ...f, manager: u }))}
            excludeUserId={form.assistantManager?.id}
          />
        );
      case "assistant_manager_id":
        return (
          <PersonPicker
            key={field.id}
            label="Assistant Manager"
            subdomain={subdomain}
            value={form.assistantManager}
            onChange={(u) => setForm((f) => ({ ...f, assistantManager: u }))}
            excludeUserId={form.manager?.id}
          />
        );
      default:
        return null;
    }
  }

  function renderCustomField(field: CustomFieldDefinition): React.ReactNode {
    return (
      <div key={field.id}>
        <label className="field-label" htmlFor={`custom-${field.fieldKey}`}>
          {field.label}
          {field.isRequired ? " *" : ""}
        </label>
        {field.fieldType === "textarea" ? (
          <textarea
            id={`custom-${field.fieldKey}`}
            className="field-input"
            rows={3}
            value={(customFieldValues[field.fieldKey] as string) ?? ""}
            onChange={(e) => setCustomFieldValues((v) => ({ ...v, [field.fieldKey]: e.target.value }))}
          />
        ) : field.fieldType === "select" ? (
          <select
            id={`custom-${field.fieldKey}`}
            className="field-input"
            value={(customFieldValues[field.fieldKey] as string) ?? ""}
            onChange={(e) => setCustomFieldValues((v) => ({ ...v, [field.fieldKey]: e.target.value }))}
          >
            <option value="">— Select —</option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : field.fieldType === "multiselect" ? (
          <select
            id={`custom-${field.fieldKey}`}
            className="field-input"
            multiple
            value={(customFieldValues[field.fieldKey] as string[]) ?? []}
            onChange={(e) =>
              setCustomFieldValues((v) => ({
                ...v,
                [field.fieldKey]: Array.from(e.target.selectedOptions, (o) => o.value),
              }))
            }
          >
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={`custom-${field.fieldKey}`}
            type={field.fieldType === "number" ? "number" : field.fieldType === "date" ? "date" : "text"}
            className="field-input"
            value={(customFieldValues[field.fieldKey] as string | number) ?? ""}
            onChange={(e) =>
              setCustomFieldValues((v) => ({
                ...v,
                [field.fieldKey]: field.fieldType === "number" ? e.target.valueAsNumber : e.target.value,
              }))
            }
          />
        )}
        {customFieldErrors[field.fieldKey] && (
          <p className="mt-1 text-xs text-red-600">{customFieldErrors[field.fieldKey]}</p>
        )}
      </div>
    );
  }

  function renderFormField(field: CustomFieldDefinition): React.ReactNode {
    return field.isSystem ? renderSystemField(field) : renderCustomField(field);
  }

  function renderRows(parentId: string | null, depth: number): React.ReactNode[] {
    const rows = childrenByParent.get(parentId) ?? [];
    return rows.flatMap((dept) => {
      const isExpanded = expanded.has(dept.id);
      const row = (
        <tr
          key={dept.id}
          className="group cursor-pointer border-t border-border hover:bg-slate-50"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("[data-row-actions]")) return;
            openView(dept);
          }}
        >
          <td className="px-4 py-3 text-sm text-primary">
            <span style={{ paddingLeft: `${depth * 20}px` }} className="flex items-center gap-2">
              {dept.hasChildren && (
                <button
                  type="button"
                  className="cursor-pointer text-slate-400 hover:text-primary"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleExpanded(dept.id);
                  }}
                  aria-label={isExpanded ? "Collapse" : "Expand"}
                >
                  {isExpanded ? "▾" : "▸"}
                </button>
              )}
              <span className="group-hover:text-cta group-hover:underline">{dept.name}</span>
            </span>
          </td>
          <td className="px-4 py-3 text-sm text-secondary">{dept.memberCount}</td>
          <td className="px-4 py-3 text-sm text-secondary">
            {byId.get(dept.parentDepartmentId ?? "")?.name ?? "—"}
          </td>
          <td className="px-4 py-3 text-sm">
            <Badge variant={dept.status === "active" ? "success" : "neutral"}>
              {dept.status === "active" ? "Active" : "Archived"}
            </Badge>
          </td>
          <td className="px-4 py-3 text-sm text-secondary">{dept.manager?.fullName ?? "—"}</td>
          <td className="px-4 py-3 text-right text-sm">
            <div className="flex justify-end">
              <RowActionsMenu
                status={dept.status}
                onEdit={() => openEdit(dept)}
                onArchiveToggle={() => handleArchiveToggle(dept)}
                onDelete={() => {
                  setDeleteTarget(dept);
                  setDeleteBlock(null);
                }}
              />
            </div>
          </td>
        </tr>
      );
      const childRows = isExpanded ? renderRows(dept.id, depth + 1) : [];
      return [row, ...childRows];
    });
  }

  const topLevelCount = (childrenByParent.get(null) ?? []).length;

  return (
    <main className="px-8 py-8">
      <div className="flex items-start justify-between">
        <PageHeader
          title="Departments"
          subtitle="Organize your team into departments and sub-departments."
        />
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Add department
        </Button>
      </div>

      <Input
        placeholder="Search departments…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 max-w-sm"
      />

      {error && <div className="banner-error mb-4">{error}</div>}

      <Card className="p-0 overflow-hidden">
        {departments === null ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
        ) : departments.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            {search
              ? "No departments match your search."
              : "No departments yet — create your first department to start organizing your team."}
          </div>
        ) : topLevelCount === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No departments match your search.</div>
        ) : (
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Name</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Member count</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Parent department</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Status</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Manager</th>
                <th className="px-4 py-2 text-right font-medium text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>{renderRows(null, 0)}</tbody>
          </table>
        )}
      </Card>

      <Drawer open={formOpen} onClose={() => setFormOpen(false)} side="right" title={editingId ? "Edit department" : "Add department"}>
        <form className="space-y-4" onSubmit={handleSubmit}>
          {formError && <div className="banner-error">{formError}</div>}
          {layoutFields.map((field) => renderFormField(field))}
          <Button type="submit" isLoading={saving} className="w-full">
            {editingId ? "Save changes" : "Create department"}
          </Button>
        </form>
      </Drawer>

      <Drawer open={!!viewTarget} onClose={() => setViewTargetId(null)} side="right" title="Department details">
        {viewTarget && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-primary">{viewTarget.name}</h3>
              <Badge variant={viewTarget.status === "active" ? "success" : "neutral"}>
                {viewTarget.status === "active" ? "Active" : "Archived"}
              </Badge>
            </div>

            <div>
              <p className="field-label">Description</p>
              <FieldValue value={viewTarget.description} placeholder="No description added" />
            </div>

            <div>
              <p className="field-label">Parent department</p>
              <p className="text-sm text-secondary">
                {byId.get(viewTarget.parentDepartmentId ?? "")?.name ?? "Top-level (no parent)"}
              </p>
            </div>

            <div>
              <p className="field-label">Members</p>
              <p className="text-sm text-secondary">{viewTarget.memberCount}</p>
            </div>

            <div>
              <p className="field-label">Manager</p>
              <FieldValue value={viewTarget.manager?.fullName} placeholder="No manager assigned" />
            </div>

            <div>
              <p className="field-label">Assistant Manager</p>
              <FieldValue value={viewTarget.assistantManager?.fullName} placeholder="No assistant manager assigned" />
            </div>

            {customFields.map((field) => {
              const value = viewCustomFieldValues[field.fieldKey];
              const display = Array.isArray(value) ? value.join(", ") : (value as string | number | undefined);
              return (
                <div key={field.id}>
                  <p className="field-label">{field.label}</p>
                  <FieldValue value={display} placeholder="Not set" />
                </div>
              );
            })}

            {(childrenByParent.get(viewTarget.id) ?? []).length > 0 && (
              <div>
                <p className="field-label">Sub-departments</p>
                <ul className="space-y-1">
                  {(childrenByParent.get(viewTarget.id) ?? []).map((child) => (
                    <li key={child.id}>
                      <button
                        type="button"
                        className="cursor-pointer text-sm text-cta hover:underline"
                        onClick={() => openView(child)}
                      >
                        {child.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Button
              onClick={() => {
                const target = viewTarget;
                setViewTargetId(null);
                openEdit(target);
              }}
              className="w-full"
            >
              Edit department
            </Button>
          </div>
        )}
      </Drawer>

      <Modal
        open={!!deleteTarget}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteBlock(null);
        }}
        title={`Delete "${deleteTarget?.name ?? ""}"?`}
      >
        {deleteBlock ? (
          <div className="space-y-4">
            <p className="text-sm text-secondary">{deleteBlock.message}</p>
            {deleteBlock.reason === "has_members" && (
              <a href={deleteBlock.membersListHref} className="text-sm font-medium text-cta hover:underline">
                Go to Members →
              </a>
            )}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteBlock(null);
                }}
              >
                Cancel
              </Button>
              {deleteTarget && (
                <Button onClick={() => handleArchiveToggle(deleteTarget)}>Archive instead</Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-secondary">
              This can&apos;t be undone. Are you sure you want to delete this department?
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteBlock(null);
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleDeleteConfirm}>Delete</Button>
            </div>
          </div>
        )}
      </Modal>
    </main>
  );
}
