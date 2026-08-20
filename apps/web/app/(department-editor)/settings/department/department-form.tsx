"use client";

// Full-screen create/edit, mirroring business-objective-form.tsx's own shape exactly (sticky header
// with Back/Cancel/Save, FormRenderer + fieldRenderers overrides for every system field, a tenant's
// own custom fields rendering generically) — the established pattern for a system-field-heavy entity
// in this codebase, now applied to Department instead of a Drawer (which department-settings-client.tsx
// used previously). Department's six system fields (Name, Parent, Description, Status, Manager,
// Assistant Manager) each keep their own bespoke control via `fieldRenderers`, exactly like
// Department's Drawer version did — only the page shell changed, not the field logic itself.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Card, Button, Input } from "@tm/ui";
import { FormRenderer, useEffectiveForm, type FieldRendererProps, type FormRendererHandle } from "@tm/form-builder";

const API_BASE = "/tenant-api/tenant";
const FORM_KEY = "department";

interface UserRef {
  id: string;
  fullName: string;
}

interface UserSearchResult {
  id: string;
  fullName: string;
  email: string;
}

interface DepartmentRow {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  parentDepartmentId: string | null;
  manager: UserRef | null;
  assistantManager: UserRef | null;
}

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

interface FormState {
  name: string;
  parentDepartmentId: string;
  description: string;
  status: "active" | "archived";
  manager: UserRef | null;
  assistantManager: UserRef | null;
}

const EMPTY_FORM: FormState = {
  name: "",
  parentDepartmentId: "",
  description: "",
  status: "active",
  manager: null,
  assistantManager: null,
};

interface DepartmentFieldContextValue {
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  departments: DepartmentRow[];
  excludedParentIds: Set<string>;
  editingId: string | null;
  subdomain: string;
}

const DepartmentFieldContext = createContext<DepartmentFieldContextValue | null>(null);

function useDepartmentFieldContext(): DepartmentFieldContextValue {
  const ctx = useContext(DepartmentFieldContext);
  if (!ctx) throw new Error("Department field renderers must be used inside DepartmentFieldContext");
  return ctx;
}

function NameField({ error }: FieldRendererProps) {
  const { form, setForm } = useDepartmentFieldContext();
  return <Input label="Name" required error={error} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />;
}

function ParentDepartmentField() {
  const { form, setForm, departments, excludedParentIds } = useDepartmentFieldContext();
  return (
    <div>
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
        {departments
          .filter((d) => !excludedParentIds.has(d.id))
          .map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
      </select>
    </div>
  );
}

function DescriptionField() {
  const { form, setForm } = useDepartmentFieldContext();
  return (
    <div>
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
}

function StatusField() {
  const { form, setForm, editingId } = useDepartmentFieldContext();
  if (!editingId) return null;
  return (
    <div>
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
}

function ManagerField() {
  const { form, setForm, subdomain } = useDepartmentFieldContext();
  return (
    <PersonPicker
      label="Manager"
      subdomain={subdomain}
      value={form.manager}
      onChange={(u) => setForm((f) => ({ ...f, manager: u }))}
      excludeUserId={form.assistantManager?.id}
    />
  );
}

function AssistantManagerField() {
  const { form, setForm, subdomain } = useDepartmentFieldContext();
  return (
    <PersonPicker
      label="Assistant Manager"
      subdomain={subdomain}
      value={form.assistantManager}
      onChange={(u) => setForm((f) => ({ ...f, assistantManager: u }))}
      excludeUserId={form.manager?.id}
    />
  );
}

const DEPARTMENT_FIELD_RENDERERS: Record<string, ComponentType<FieldRendererProps>> = {
  name: NameField,
  parent_department_id: ParentDepartmentField,
  description: DescriptionField,
  status: StatusField,
  manager_id: ManagerField,
  assistant_manager_id: AssistantManagerField,
};

export default function DepartmentForm({ subdomain, departmentId }: { subdomain: string; departmentId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = !!departmentId;
  const formRendererRef = useRef<FormRendererHandle>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});
  const [initialized, setInitialized] = useState(!isEditing);

  const { form: effectiveForm } = useEffectiveForm(FORM_KEY, subdomain);

  // No single-department GET route exists (only list/create/edit/delete) — the list is
  // tenant-bounded and already the source of the Parent-department picker's own options, so this
  // one fetch backs both needs, exactly as the previous Drawer-based flow (which always had the
  // list in memory already) relied on the same data.
  const departmentsQuery = useQuery({
    queryKey: ["departments", subdomain],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/departments?subdomain=${encodeURIComponent(subdomain)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Couldn't load departments. Try again.");
      const json = (await res.json()) as { data: DepartmentRow[] };
      return json.data;
    },
  });
  const departments = departmentsQuery.data ?? [];

  const customFieldValuesQuery = useQuery({
    queryKey: ["department-custom-field-values", departmentId, subdomain],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/custom-field-values?formKey=${FORM_KEY}&entityId=${departmentId}&subdomain=${encodeURIComponent(subdomain)}`,
        { credentials: "include" },
      );
      const json = (await res.json()) as { data: Record<string, unknown> };
      return json.data;
    },
    enabled: isEditing,
  });

  useEffect(() => {
    if (!isEditing || initialized || !departmentsQuery.data) return;
    const existing = departmentsQuery.data.find((d) => d.id === departmentId);
    if (!existing) {
      setFormError("This department couldn't be found.");
      setInitialized(true);
      return;
    }
    setForm({
      name: existing.name,
      parentDepartmentId: existing.parentDepartmentId ?? "",
      description: existing.description ?? "",
      status: existing.status,
      manager: existing.manager,
      assistantManager: existing.assistantManager,
    });
    setInitialized(true);
  }, [isEditing, initialized, departmentsQuery.data, departmentId]);

  useEffect(() => {
    if (customFieldValuesQuery.data) setCustomFieldValues(customFieldValuesQuery.data);
  }, [customFieldValuesQuery.data]);

  const loading = isEditing && !initialized;

  function backToList() {
    router.push("/settings/department");
  }

  const excludedParentIds = useMemo(() => computeExcludedParentIds(departments, departmentId ?? null), [departments, departmentId]);

  const rendererValues = {
    name: form.name,
    parent_department_id: form.parentDepartmentId,
    description: form.description,
    status: form.status,
    manager_id: form.manager?.id ?? null,
    assistant_manager_id: form.assistantManager?.id ?? null,
    ...customFieldValues,
  };

  function handleFieldChange(fieldKey: string, value: unknown) {
    setCustomFieldValues((v) => ({ ...v, [fieldKey]: value }));
  }

  const departmentFieldContextValue: DepartmentFieldContextValue = {
    form,
    setForm,
    departments,
    excludedParentIds,
    editingId: departmentId ?? null,
    subdomain,
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name.trim(),
        parentDepartmentId: form.parentDepartmentId || null,
        description: form.description || undefined,
        ...(isEditing ? { status: form.status } : {}),
        managerId: form.manager?.id ?? null,
        assistantManagerId: form.assistantManager?.id ?? null,
        customFieldValues,
      };
      const url = isEditing
        ? `${API_BASE}/departments/${departmentId}?subdomain=${encodeURIComponent(subdomain)}`
        : `${API_BASE}/departments?subdomain=${encodeURIComponent(subdomain)}`;
      const res = await fetch(url, {
        method: isEditing ? "PATCH" : "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as
          | { message?: string; errors?: { fieldKey: string; message: string }[] }
          | null;
        throw { json };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["departments", subdomain] });
      router.push(`/settings/department?${isEditing ? "updated" : "created"}=1`);
    },
    onError: (err: { json?: { message?: string; errors?: { fieldKey: string; message: string }[] } | null }) => {
      const json = err?.json;
      if (json?.errors) {
        setCustomFieldErrors(Object.fromEntries(json.errors.map((e) => [e.fieldKey, e.message])));
        setFormError("Some custom fields need attention.");
        return;
      }
      setFormError(json?.message ?? "Couldn't save this department. Try again.");
    },
  });

  function handleSubmit() {
    setFormError(null);
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setFormError("Name is required.");
      return;
    }
    const isDuplicate = departments.some((d) => d.id !== departmentId && d.name.toLowerCase() === trimmedName.toLowerCase());
    if (isDuplicate) {
      setFormError("A department with this name already exists.");
      return;
    }
    if (form.manager && form.assistantManager && form.manager.id === form.assistantManager.id) {
      setFormError("Manager and Assistant Manager must be different people.");
      return;
    }
    if (!formRendererRef.current?.validate()) {
      setFormError("Some fields need attention before this can be saved.");
      return;
    }
    saveMutation.mutate();
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-white px-8 py-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Back to Departments"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-secondary hover:bg-slate-50 hover:text-primary"
            onClick={backToList}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="shell-page-header-title text-xl">{isEditing ? "Edit department" : "Add department"}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={backToList}>
            Cancel
          </Button>
          <Button isLoading={saveMutation.isPending} onClick={handleSubmit}>
            {isEditing ? "Save changes" : "Create department"}
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-8 py-8">
        <Card className="space-y-5 p-6">
          {formError && <div className="banner-error">{formError}</div>}

          <DepartmentFieldContext.Provider value={departmentFieldContextValue}>
            <FormRenderer
              ref={formRendererRef}
              form={effectiveForm}
              values={rendererValues}
              onChange={handleFieldChange}
              onSubmit={() => {}}
              errors={customFieldErrors}
              fieldRenderers={DEPARTMENT_FIELD_RENDERERS}
              hideActions
              subdomain={subdomain}
            />
          </DepartmentFieldContext.Provider>
        </Card>
      </main>
    </div>
  );
}
