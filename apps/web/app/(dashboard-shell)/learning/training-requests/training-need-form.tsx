"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader, Card, Badge, Button, Input } from "@tm/ui";
import { STATUS_LABEL, STATUS_BADGE_VARIANT, type TrainingNeedStatus } from "./status";

const API_BASE = "/tenant-api/tenant";

type Priority = "low" | "medium" | "high";

type CustomFieldType = "text" | "textarea" | "number" | "date" | "select" | "multiselect";

interface CustomFieldDefinition {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: CustomFieldType;
  options: string[] | null;
  isRequired: boolean;
  isSystem: boolean;
}

interface DepartmentOption {
  id: string;
  name: string;
}

interface TrainingNeedRow {
  id: string;
  departmentId: string;
  departmentName: string | null;
  title: string;
  priority: Priority;
  status: TrainingNeedStatus;
}

interface FormState {
  title: string;
  priority: Priority;
  departmentId: string;
}

const EMPTY_FORM: FormState = { title: "", priority: "medium", departmentId: "" };

/**
 * Shared by `/learning/training-requests/new` (create) and `/learning/training-requests/[id]` (edit) — a dedicated full page
 * per direct product feedback, not a Drawer overlay (unlike Department/Team/Roles' own forms).
 * Every field stacks single-column, full width, in whatever order `layoutFields` reports (per
 * direct product feedback — superseded an earlier two-column paired layout).
 */
export default function TrainingNeedForm({
  subdomain,
  trainingNeedId,
  canManageAll,
}: {
  subdomain: string;
  trainingNeedId?: string;
  canManageAll: boolean;
}) {
  const router = useRouter();
  const isEditing = !!trainingNeedId;

  const [loading, setLoading] = useState(isEditing);
  const [status, setStatus] = useState<TrainingNeedStatus>("draft");
  const [departmentName, setDepartmentName] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);

  const [layoutFields, setLayoutFields] = useState<CustomFieldDefinition[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(
      `${API_BASE}/form-fields?formKey=training_needs_analysis&subdomain=${encodeURIComponent(subdomain)}`,
      { credentials: "include" },
    )
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((json: { data: CustomFieldDefinition[] }) => setLayoutFields(json.data))
      .catch(() => setLayoutFields([]));
  }, [subdomain]);

  useEffect(() => {
    if (!canManageAll) return;
    fetch(`${API_BASE}/departments?subdomain=${encodeURIComponent(subdomain)}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((json: { data: DepartmentOption[] }) => setDepartments(json.data))
      .catch(() => setDepartments([]));
  }, [subdomain, canManageAll]);

  useEffect(() => {
    if (!trainingNeedId) return;
    fetch(`${API_BASE}/training-needs/${trainingNeedId}?subdomain=${encodeURIComponent(subdomain)}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { data: TrainingNeedRow } | null) => {
        if (!json) {
          setFormError("This training request couldn't be found.");
          return;
        }
        setForm({ title: json.data.title, priority: json.data.priority, departmentId: json.data.departmentId });
        setStatus(json.data.status);
        setDepartmentName(json.data.departmentName);
      })
      .catch(() => setFormError("Couldn't load this training request. Try again."))
      .finally(() => setLoading(false));

    fetch(
      `${API_BASE}/custom-field-values?formKey=training_needs_analysis&entityId=${trainingNeedId}&subdomain=${encodeURIComponent(subdomain)}`,
      { credentials: "include" },
    )
      .then((res) => (res.ok ? res.json() : { data: {} }))
      .then((json: { data: Record<string, unknown> }) => setCustomFieldValues(json.data))
      .catch(() => setCustomFieldValues({}));
  }, [trainingNeedId, subdomain]);

  const customFields = layoutFields.filter((f) => !f.isSystem);

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

  async function handleSave(nextStatus?: "submitted") {
    setFormError(null);
    if (!form.title.trim()) {
      setFormError("Title is required.");
      return;
    }
    if (canManageAll && !isEditing && !form.departmentId) {
      setFormError("Department is required.");
      return;
    }
    if (nextStatus === "submitted" && !validateCustomFields()) {
      setFormError("Some fields need attention before this can be submitted.");
      return;
    }

    setSaving(true);
    const body = {
      title: form.title.trim(),
      priority: form.priority,
      ...(canManageAll && !isEditing ? { departmentId: form.departmentId } : {}),
      ...(nextStatus ? { status: nextStatus } : {}),
      customFieldValues,
    };
    const url = isEditing
      ? `${API_BASE}/training-needs/${trainingNeedId}?subdomain=${encodeURIComponent(subdomain)}`
      : `${API_BASE}/training-needs?subdomain=${encodeURIComponent(subdomain)}`;
    const res = await fetch(url, {
      method: isEditing ? "PATCH" : "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) {
      // Land on the entry's own view page (not the list) — lets you see what you just
      // saved/created immediately, matching the new dedicated view page.
      const json = (await res.json().catch(() => null)) as { data?: { id: string } } | null;
      const savedId = trainingNeedId ?? json?.data?.id;
      router.push(savedId ? `/learning/training-requests/${savedId}` : "/learning/training-requests");
      return;
    }
    const json = (await res.json().catch(() => null)) as
      | { message?: string; errors?: { fieldKey: string; message: string }[] }
      | null;
    if (json?.errors) {
      setCustomFieldErrors(Object.fromEntries(json.errors.map((e) => [e.fieldKey, e.message])));
      setFormError("Some fields need attention.");
      return;
    }
    setFormError(json?.message ?? "Couldn't save this training request. Try again.");
  }

  /** Whether a field actually renders a control at all — `status` never does (driven by the
   * Save-as-draft/Submit actions instead), and `department_id` only does for a
   * `training_request.manage.all` caller creating a new entry. Filtered out before row-pairing so
   * a hidden field never "uses up" a pairing slot next to a real one. */
  function fieldWillRender(field: CustomFieldDefinition): boolean {
    if (!field.isSystem) return true;
    if (field.fieldKey === "status") return false;
    if (field.fieldKey === "department_id") return canManageAll && !isEditing;
    return true;
  }

  function renderField(field: CustomFieldDefinition): React.ReactNode {
    return field.isSystem ? renderSystemField(field) : renderCustomField(field);
  }

  /** TNA's real, hardcoded controls for its four fixed system fields — matched by `fieldKey`,
   * exactly like Department's own `renderSystemField` (research.md §5). Rendered in whatever order
   * `layoutFields` reports (its own seeded `displayOrder`, overridden by any tenant drag-reorder),
   * interleaved with tenant custom fields, instead of a fixed JSX position — the whole point of
   * system fields being placeholder rows in the same unified order as custom fields. */
  function renderSystemField(field: CustomFieldDefinition): React.ReactNode {
    switch (field.fieldKey) {
      case "title":
        return (
          <div key={field.id}>
            <Input
              label="Title"
              required
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>
        );
      case "priority":
        return (
          <div key={field.id}>
            <label className="field-label" htmlFor="priority">
              Priority
            </label>
            <select
              id="priority"
              className="field-input"
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as Priority }))}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        );
      case "department_id":
        // Only a picker for training_request.manage.all creating a new entry (spec FR-002) — never editable
        // once created, shown instead as the header subtitle in edit mode (not inline here).
        if (!canManageAll || isEditing) return null;
        return (
          <div key={field.id}>
            <label className="field-label" htmlFor="departmentId">
              Department
            </label>
            <select
              id="departmentId"
              className="field-input"
              value={form.departmentId}
              onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
            >
              <option value="">— Select a department —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        );
      case "status":
        // Never a manually-set control — driven entirely by the Save as draft/Submit actions
        // (shown as the header badge instead), same treatment Department gives its own status
        // field on create.
        return null;
      default:
        return null;
    }
  }

  function renderCustomField(field: CustomFieldDefinition): React.ReactNode {
    const isMultiselect = field.fieldType === "multiselect";
    return (
      <div key={field.id}>
        {isMultiselect ? (
          // Not a <label htmlFor> — a checkbox group has no single control to point at; each
          // checkbox below carries its own label instead.
          <p className="field-label">
            {field.label}
            {field.isRequired ? " *" : ""}
          </p>
        ) : (
          <label className="field-label" htmlFor={`custom-${field.fieldKey}`}>
            {field.label}
            {field.isRequired ? " *" : ""}
          </label>
        )}
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
        ) : isMultiselect ? (
          // A native <select multiple> requires holding Ctrl/Cmd while clicking to select more
          // than one option — a plain click replaces the whole selection instead of toggling it,
          // which reads as "doesn't work" to anyone who hasn't used a native multi-select listbox
          // before. Checkboxes are the standard, discoverable pattern for this — no library needed.
          <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-lg border border-border bg-white px-3 py-2.5">
            {(field.options ?? []).map((option) => {
              const selected = ((customFieldValues[field.fieldKey] as string[]) ?? []).includes(option);
              return (
                <label key={option} className="flex cursor-pointer items-center gap-2 text-sm text-secondary">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/20"
                    checked={selected}
                    onChange={(e) =>
                      setCustomFieldValues((v) => {
                        const current = (v[field.fieldKey] as string[]) ?? [];
                        const next = e.target.checked
                          ? [...current, option]
                          : current.filter((o) => o !== option);
                        return { ...v, [field.fieldKey]: next };
                      })
                    }
                  />
                  {option}
                </label>
              );
            })}
          </div>
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

  if (isEditing && loading) {
    return (
      <main className="px-8 py-8">
        <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-8 py-8">
      <button
        type="button"
        className="mb-4 flex cursor-pointer items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary"
        onClick={() => router.push("/learning/training-requests")}
      >
        <ArrowLeft className="h-4 w-4" />
        Training Requests
      </button>

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <PageHeader
            title={isEditing ? "Edit training request" : "New training request"}
            subtitle={
              isEditing
                ? (departmentName ?? undefined)
                : canManageAll
                  ? "Create a training request for any department."
                  : "Create a training request for your department."
            }
          />
          {isEditing && <Badge variant={STATUS_BADGE_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>}
        </div>
        <Button
          variant="secondary"
          onClick={() => router.push(isEditing ? `/learning/training-requests/${trainingNeedId}` : "/learning/training-requests")}
        >
          Cancel
        </Button>
      </div>

      <Card className="mt-6 p-6">
        {formError && <div className="banner-error mb-4">{formError}</div>}

        <div className="space-y-4">{layoutFields.filter(fieldWillRender).map((field) => renderField(field))}</div>

        <div className="mt-8 flex justify-end gap-2 border-t border-border pt-6">
          {status === "draft" ? (
            <>
              <Button variant="secondary" isLoading={saving} onClick={() => handleSave()}>
                Save as draft
              </Button>
              <Button isLoading={saving} onClick={() => handleSave("submitted")}>
                Submit
              </Button>
            </>
          ) : (
            // Submitted or Approved — editing never re-offers Submit (spec FR-006's "editing after
            // submission doesn't reset status" extends the same way to Approved: content can still
            // be corrected, but only the dedicated Approve action on the view page changes status).
            <Button isLoading={saving} onClick={() => handleSave()}>
              Save changes
            </Button>
          )}
        </div>
      </Card>
    </main>
  );
}
