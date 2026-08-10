"use client";

// Form Builder spec (033), User Story 4 — migrated onto `useEffectiveForm` + `<FormRenderer>`,
// removing `renderField`/`renderSystemField`/`renderCustomField`. TNA's own draft → submitted →
// approved workflow (`apps/api/src/training-needs/tenant-training-needs-routes.ts`) is completely
// untouched by this migration (research.md §9) — only how fields are *rendered* changes.
//
// TNA needs two independently-validated actions ("Save as draft" skips required-field validation
// entirely; "Submit" enforces it) where every other migrated consumer only needed one — so this
// page renders `<FormRenderer hideActions>` (suppressing its built-in single submit button) and
// drives its own two buttons via the `FormRendererHandle` ref's `validate()` method for the
// "Submit" path only, exactly the extension point `contracts/form-renderer-package.md` documents
// for a consumer with more than one differently-validated action.
import { createContext, useContext, useEffect, useRef, useState, type ComponentType, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { PageHeader, Card, Badge, Button, Input } from "@tm/ui";
import { FormRenderer, useEffectiveForm, type FieldRendererProps, type FormRendererHandle } from "@tm/form-builder";
import { STATUS_LABEL, STATUS_BADGE_VARIANT, type TrainingNeedStatus } from "./status";

const API_BASE = "/tenant-api/tenant";

type Priority = "low" | "medium" | "high";

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

interface TnaFieldContextValue {
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  departments: DepartmentOption[];
  canManageAll: boolean;
  isEditing: boolean;
}

/** Backs TNA's `fieldRenderers` overrides (spec FR-029) — Title/Priority are simple but
 * feature-typed controls, Department is a picker only shown for one caller/mode combination, and
 * Status never has a manual control at all (driven by the Save-as-draft/Submit actions instead).
 * Module-level context so these components' identities stay stable across renders. */
const TnaFieldContext = createContext<TnaFieldContextValue | null>(null);

function useTnaFieldContext(): TnaFieldContextValue {
  const ctx = useContext(TnaFieldContext);
  if (!ctx) throw new Error("TNA field renderers must be used inside TnaFieldContext");
  return ctx;
}

function TitleField({ error }: FieldRendererProps) {
  const { form, setForm } = useTnaFieldContext();
  return <Input label="Title" required error={error} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />;
}

function PriorityField() {
  const { form, setForm } = useTnaFieldContext();
  return (
    <div>
      <label className="field-label" htmlFor="priority">
        Priority
      </label>
      <select id="priority" className="field-input" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as Priority }))}>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
    </div>
  );
}

function TnaDepartmentField() {
  const { form, setForm, departments, canManageAll, isEditing } = useTnaFieldContext();
  // Only a picker for a training_request.manage.all caller creating a new entry (spec FR-002) —
  // never editable once created (shown instead as the header subtitle), and never shown at all
  // for a caller scoped to their own department (the server assigns it).
  if (!canManageAll || isEditing) return null;
  return (
    <div>
      <label className="field-label" htmlFor="departmentId">
        Department
      </label>
      <select id="departmentId" className="field-input" value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}>
        <option value="">— Select a department —</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// Never a manually-set control — driven entirely by the Save as draft/Submit actions (shown as
// the header badge instead), same treatment Department gives its own status field on create.
function TnaStatusField() {
  return null;
}

const TNA_FIELD_RENDERERS: Record<string, ComponentType<FieldRendererProps>> = {
  title: TitleField,
  priority: PriorityField,
  department_id: TnaDepartmentField,
  status: TnaStatusField,
};

/**
 * Shared by `/learning/training-requests/new` (create) and `/learning/training-requests/[id]` (edit) — a dedicated full page
 * per direct product feedback, not a Drawer overlay (unlike Department/Team/Roles' own forms).
 * Every field stacks single-column, full width, in whatever order the effective form reports.
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
  const queryClient = useQueryClient();
  const isEditing = !!trainingNeedId;
  const formRendererRef = useRef<FormRendererHandle>(null);

  const [status, setStatus] = useState<TrainingNeedStatus>("draft");
  const [departmentName, setDepartmentName] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const { form: effectiveForm } = useEffectiveForm("training_needs_analysis", subdomain);

  const departmentsQuery = useQuery({
    queryKey: ["training-need-departments", subdomain],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/departments?subdomain=${encodeURIComponent(subdomain)}`, { credentials: "include" });
      const json = (res.ok ? await res.json() : { data: [] }) as { data: DepartmentOption[] };
      return json.data;
    },
    enabled: canManageAll,
  });
  const departments = departmentsQuery.data ?? [];

  const entryQuery = useQuery({
    queryKey: ["training-need", trainingNeedId, subdomain],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/training-needs/${trainingNeedId}?subdomain=${encodeURIComponent(subdomain)}`, { credentials: "include" });
      if (!res.ok) throw new Error("This training request couldn't be found.");
      const json = (await res.json()) as { data: TrainingNeedRow };
      return json.data;
    },
    enabled: isEditing,
    retry: false,
  });

  const existingCustomFieldValuesQuery = useQuery({
    queryKey: ["training-need-custom-field-values", trainingNeedId, subdomain],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/custom-field-values?formKey=training_needs_analysis&entityId=${trainingNeedId}&subdomain=${encodeURIComponent(subdomain)}`,
        { credentials: "include" },
      );
      const json = (res.ok ? await res.json() : { data: {} }) as { data: Record<string, unknown> };
      return json.data;
    },
    enabled: isEditing,
  });

  const loading = isEditing && entryQuery.isPending;

  useEffect(() => {
    if (entryQuery.data) {
      setForm({ title: entryQuery.data.title, priority: entryQuery.data.priority, departmentId: entryQuery.data.departmentId });
      setStatus(entryQuery.data.status);
      setDepartmentName(entryQuery.data.departmentName);
    }
  }, [entryQuery.data]);

  useEffect(() => {
    if (entryQuery.error) setFormError((entryQuery.error as Error).message);
  }, [entryQuery.error]);

  useEffect(() => {
    if (existingCustomFieldValuesQuery.data) setCustomFieldValues(existingCustomFieldValuesQuery.data);
  }, [existingCustomFieldValuesQuery.data]);

  // `department_id` is nominally required (spec 049 seed) for the one mode where a real picker
  // shows it; for every other mode (editing, or a caller scoped to their own department) no
  // control ever sets it, so a placeholder satisfies FormRenderer's generic required-check
  // without ever being sent — the submit payload below only includes `departmentId` when
  // `canManageAll && !isEditing`, exactly when this placeholder would have been overwritten by a
  // real selection instead.
  useEffect(() => {
    if (!canManageAll && !isEditing) {
      setForm((f) => (f.departmentId ? f : { ...f, departmentId: "__implicit__" }));
    }
  }, [canManageAll, isEditing]);

  const rendererValues = {
    title: form.title,
    priority: form.priority,
    department_id: form.departmentId,
    status: status,
    ...customFieldValues,
  };

  function handleFieldChange(fieldKey: string, value: unknown) {
    setCustomFieldValues((v) => ({ ...v, [fieldKey]: value }));
  }

  const tnaFieldContextValue: TnaFieldContextValue = { form, setForm, departments, canManageAll, isEditing };

  const saveMutation = useMutation({
    mutationFn: async (nextStatus?: "submitted") => {
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
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string; errors?: { fieldKey: string; message: string }[] } | null;
        throw { json };
      }
      return (await res.json().catch(() => null)) as { data?: { id: string } } | null;
    },
    onSuccess: (json) => {
      queryClient.invalidateQueries({ queryKey: ["training-needs", subdomain] });
      queryClient.invalidateQueries({ queryKey: ["training-need", trainingNeedId, subdomain] });
      const savedId = trainingNeedId ?? json?.data?.id;
      router.push(savedId ? `/learning/training-requests/${savedId}` : "/learning/training-requests");
    },
    onError: (err: { json?: { message?: string; errors?: { fieldKey: string; message: string }[] } | null }) => {
      const json = err?.json;
      if (json?.errors) {
        setCustomFieldErrors(Object.fromEntries(json.errors.map((e) => [e.fieldKey, e.message])));
        setFormError("Some fields need attention.");
        return;
      }
      setFormError(json?.message ?? "Couldn't save this training request. Try again.");
    },
  });

  // `nextStatus === "submitted"` is the only case that enforces full required-field validation
  // (via the FormRenderer ref, spec-equivalent of the old `validateCustomFields()`) — saving a
  // draft, or re-saving an already-submitted/approved entry, never blocks on incomplete fields,
  // matching the original behavior exactly.
  function handleSave(nextStatus?: "submitted") {
    setFormError(null);
    if (!form.title.trim()) {
      setFormError("Title is required.");
      return;
    }
    if (canManageAll && !isEditing && !form.departmentId) {
      setFormError("Department is required.");
      return;
    }
    if (nextStatus === "submitted" && !formRendererRef.current?.validate()) {
      setFormError("Some fields need attention before this can be submitted.");
      return;
    }
    saveMutation.mutate(nextStatus);
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

        <TnaFieldContext.Provider value={tnaFieldContextValue}>
          <FormRenderer
            ref={formRendererRef}
            form={effectiveForm}
            values={rendererValues}
            onChange={handleFieldChange}
            onSubmit={() => {}}
            errors={customFieldErrors}
            fieldRenderers={TNA_FIELD_RENDERERS}
            hideActions
            subdomain={subdomain}
          />
        </TnaFieldContext.Provider>

        <div className="mt-8 flex justify-end gap-2 border-t border-border pt-6">
          {status === "draft" ? (
            <>
              <Button variant="secondary" isLoading={saveMutation.isPending} onClick={() => handleSave()}>
                Save as draft
              </Button>
              <Button isLoading={saveMutation.isPending} onClick={() => handleSave("submitted")}>
                Submit
              </Button>
            </>
          ) : (
            // Submitted or Approved — editing never re-offers Submit (spec FR-006's "editing after
            // submission doesn't reset status" extends the same way to Approved: content can still
            // be corrected, but only the dedicated Approve action on the view page changes status).
            <Button isLoading={saveMutation.isPending} onClick={() => handleSave()}>
              Save changes
            </Button>
          )}
        </div>
      </Card>
    </main>
  );
}
