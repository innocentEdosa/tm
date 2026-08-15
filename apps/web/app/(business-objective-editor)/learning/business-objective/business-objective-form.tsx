"use client";

// Form Builder spec (033) — migrated onto `useEffectiveForm` + `<FormRenderer>`, mirroring
// training-need-form.tsx's own migration exactly. Business Objectives' nine fixed fields (Title,
// Category, Description, Owner, Due Date, Priority, Metric/KPI, Baseline, Target, Status) are this
// form's "system" fields (seeded via 0139_register_business_objective_form_type.sql, matched by
// field_key below) — each keeps its own bespoke control (search/create combobox, department
// picker, radio group, etc.) via a `fieldRenderers` override, exactly like TNA's Title/Priority/
// Department/Status overrides. A tenant's own custom fields, added through Settings > Forms,
// render generically through FormRenderer with no code change needed here.
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Lightbulb } from "lucide-react";
import { Card, Button, Input } from "@tm/ui";
import { FormRenderer, useEffectiveForm, type FieldRendererProps, type FormRendererHandle } from "@tm/form-builder";
import { tenantFetch } from "@/lib/tenant-api-client";
import DepartmentPicker, { type DepartmentRef } from "./department-picker";
import BusinessObjectiveCategoryCombobox from "./business-objective-category-combobox";

const API_BASE = "/tenant-api/tenant";
const FORM_KEY = "business_objective";

type Priority = "low" | "medium" | "high";
type Status = "not_started" | "on_track" | "at_risk" | "done";

interface BusinessObjectiveRow {
  id: string;
  title: string;
  categoryId: string;
  categoryName: string;
  description: string | null;
  ownerDepartmentId: string;
  ownerDepartmentName: string;
  dueDate: string;
  priority: Priority;
  metricName: string;
  baselineValue: number | null;
  targetValue: number | null;
  status: Status;
}

interface FormState {
  title: string;
  category: string;
  description: string;
  ownerDepartment: DepartmentRef | null;
  dueDate: string;
  priority: Priority;
  metricName: string;
  baselineValue: string;
  targetValue: string;
  status: Status;
}

const EMPTY_FORM: FormState = {
  title: "",
  category: "",
  description: "",
  ownerDepartment: null,
  dueDate: "",
  priority: "medium",
  metricName: "",
  baselineValue: "",
  targetValue: "",
  status: "not_started",
};

interface BoFieldContextValue {
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  subdomain: string;
}

/** Backs Business Objective's `fieldRenderers` overrides — every system field is a bespoke,
 * feature-typed control, not a generic input, so each reads/writes this shared state directly
 * rather than the `value`/`onChange` props `FormRenderer` would otherwise pass. Module-level
 * context so these components' identities stay stable across renders (same pattern as TNA's own
 * `TnaFieldContext`). */
const BoFieldContext = createContext<BoFieldContextValue | null>(null);

function useBoFieldContext(): BoFieldContextValue {
  const ctx = useContext(BoFieldContext);
  if (!ctx) throw new Error("Business Objective field renderers must be used inside BoFieldContext");
  return ctx;
}

function TitleField({ error }: FieldRendererProps) {
  const { form, setForm } = useBoFieldContext();
  return (
    <Input
      label="Objective Title"
      placeholder="e.g., Expand into EMEA market"
      required
      error={error}
      value={form.title}
      onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
    />
  );
}

function CategoryField() {
  const { form, setForm, subdomain } = useBoFieldContext();
  return (
    <BusinessObjectiveCategoryCombobox
      subdomain={subdomain}
      value={form.category}
      onChange={(name) => setForm((f) => ({ ...f, category: name }))}
    />
  );
}

function DescriptionField() {
  const { form, setForm } = useBoFieldContext();
  return (
    <div>
      <label className="field-label" htmlFor="bo-description">
        Detailed Description
      </label>
      <textarea
        id="bo-description"
        className="field-input"
        rows={4}
        placeholder="Provide context, scope, and expected outcomes…"
        value={form.description}
        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
      />
    </div>
  );
}

function OwnerDepartmentField() {
  const { form, setForm, subdomain } = useBoFieldContext();
  return (
    <DepartmentPicker
      subdomain={subdomain}
      value={form.ownerDepartment}
      onChange={(department) => setForm((f) => ({ ...f, ownerDepartment: department }))}
    />
  );
}

function DueDateField({ error }: FieldRendererProps) {
  const { form, setForm } = useBoFieldContext();
  return (
    <Input
      label="Target Completion Date"
      type="date"
      required
      error={error}
      value={form.dueDate}
      onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
    />
  );
}

function PriorityField() {
  const { form, setForm } = useBoFieldContext();
  return (
    <div>
      <label className="field-label">Priority Level</label>
      <div className="mt-2 flex h-11 items-center gap-4">
        {(["high", "medium", "low"] as Priority[]).map((p) => (
          <label key={p} className="flex cursor-pointer items-center gap-1.5 text-sm text-primary">
            <input
              type="radio"
              name="bo-priority"
              value={p}
              checked={form.priority === p}
              onChange={() => setForm((f) => ({ ...f, priority: p }))}
              className="h-4 w-4 accent-cta"
            />
            {p === "high" ? "High" : p === "medium" ? "Medium" : "Low"}
          </label>
        ))}
      </div>
    </div>
  );
}

function MetricNameField() {
  const { form, setForm } = useBoFieldContext();
  return (
    <div>
      <label className="field-label" htmlFor="bo-metric">
        Success Metrics / KPIs
      </label>
      <p className="field-hint">How will we measure success?</p>
      <textarea
        id="bo-metric"
        className="field-input"
        rows={3}
        placeholder="e.g., Achieve 15% market share in EMEA by Q4."
        value={form.metricName}
        onChange={(e) => setForm((f) => ({ ...f, metricName: e.target.value }))}
      />
    </div>
  );
}

function BaselineValueField() {
  const { form, setForm } = useBoFieldContext();
  return (
    <Input
      label="Baseline Value"
      type="number"
      step="any"
      value={form.baselineValue}
      onChange={(e) => setForm((f) => ({ ...f, baselineValue: e.target.value }))}
    />
  );
}

function TargetValueField() {
  const { form, setForm } = useBoFieldContext();
  return (
    <Input
      label="Target Value"
      type="number"
      step="any"
      value={form.targetValue}
      onChange={(e) => setForm((f) => ({ ...f, targetValue: e.target.value }))}
    />
  );
}

function StatusField() {
  const { form, setForm } = useBoFieldContext();
  return (
    <div>
      <label className="field-label" htmlFor="bo-status">
        Status
      </label>
      <select
        id="bo-status"
        className="field-input"
        value={form.status}
        onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Status }))}
      >
        <option value="not_started">Not started</option>
        <option value="on_track">On track</option>
        <option value="at_risk">At risk</option>
        <option value="done">Done</option>
      </select>
    </div>
  );
}

const BUSINESS_OBJECTIVE_FIELD_RENDERERS: Record<string, ComponentType<FieldRendererProps>> = {
  title: TitleField,
  category: CategoryField,
  description: DescriptionField,
  owner_department_id: OwnerDepartmentField,
  due_date: DueDateField,
  priority: PriorityField,
  metric_name: MetricNameField,
  baseline_value: BaselineValueField,
  target_value: TargetValueField,
  status: StatusField,
};

export default function BusinessObjectiveForm({
  subdomain,
  businessObjectiveId,
}: {
  subdomain: string;
  businessObjectiveId?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = !!businessObjectiveId;
  const formRendererRef = useRef<FormRendererHandle>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});

  const { form: effectiveForm } = useEffectiveForm(FORM_KEY, subdomain);

  const entryQuery = useQuery({
    queryKey: ["business-objective", businessObjectiveId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: BusinessObjectiveRow }>(
        `/business-objectives/${businessObjectiveId}`,
        { subdomain },
      );
      return data;
    },
    enabled: isEditing,
    retry: false,
  });

  useEffect(() => {
    if (entryQuery.data) {
      const row = entryQuery.data;
      setForm({
        title: row.title,
        category: row.categoryName,
        description: row.description ?? "",
        ownerDepartment: { id: row.ownerDepartmentId, name: row.ownerDepartmentName },
        dueDate: row.dueDate,
        priority: row.priority,
        metricName: row.metricName,
        baselineValue: row.baselineValue === null ? "" : String(row.baselineValue),
        targetValue: row.targetValue === null ? "" : String(row.targetValue),
        status: row.status,
      });
    }
  }, [entryQuery.data]);

  useEffect(() => {
    if (entryQuery.error) setFormError((entryQuery.error as Error).message);
  }, [entryQuery.error]);

  const existingCustomFieldValuesQuery = useQuery({
    queryKey: ["business-objective-custom-field-values", businessObjectiveId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: Record<string, unknown> }>(
        `/custom-field-values?formKey=${FORM_KEY}&entityId=${businessObjectiveId}`,
        { subdomain },
      );
      return data;
    },
    enabled: isEditing,
  });

  useEffect(() => {
    if (existingCustomFieldValuesQuery.data) setCustomFieldValues(existingCustomFieldValuesQuery.data);
  }, [existingCustomFieldValuesQuery.data]);

  const loading = isEditing && entryQuery.isPending;

  function backToList() {
    router.push("/learning/business-objective");
  }

  const rendererValues = {
    title: form.title,
    category: form.category,
    description: form.description,
    owner_department_id: form.ownerDepartment?.id ?? "",
    due_date: form.dueDate,
    priority: form.priority,
    metric_name: form.metricName,
    baseline_value: form.baselineValue,
    target_value: form.targetValue,
    status: form.status,
    ...customFieldValues,
  };

  function handleFieldChange(fieldKey: string, value: unknown) {
    setCustomFieldValues((v) => ({ ...v, [fieldKey]: value }));
  }

  const boFieldContextValue: BoFieldContextValue = { form, setForm, subdomain };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        title: form.title.trim(),
        category: form.category.trim(),
        description: form.description.trim() || null,
        ownerDepartmentId: form.ownerDepartment?.id,
        dueDate: form.dueDate,
        priority: form.priority,
        metricName: form.metricName.trim(),
        baselineValue: form.baselineValue.trim() === "" ? null : Number(form.baselineValue),
        targetValue: form.targetValue.trim() === "" ? null : Number(form.targetValue),
        status: form.status,
        customFieldValues,
      };
      const url = isEditing
        ? `${API_BASE}/business-objectives/${businessObjectiveId}?subdomain=${encodeURIComponent(subdomain)}`
        : `${API_BASE}/business-objectives?subdomain=${encodeURIComponent(subdomain)}`;
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
      queryClient.invalidateQueries({ queryKey: ["business-objectives", subdomain] });
      router.push(`/learning/business-objective?${isEditing ? "updated" : "created"}=1`);
    },
    onError: (err: { json?: { message?: string; errors?: { fieldKey: string; message: string }[] } | null }) => {
      const json = err?.json;
      if (json?.errors) {
        setCustomFieldErrors(Object.fromEntries(json.errors.map((e) => [e.fieldKey, e.message])));
        setFormError("Some fields need attention.");
        return;
      }
      setFormError(json?.message ?? "Couldn't save this objective. Try again.");
    },
  });

  function handleSubmit() {
    setFormError(null);
    if (!form.title.trim()) return setFormError("Objective title is required.");
    if (!form.category.trim()) return setFormError("Category is required.");
    if (!form.ownerDepartment) return setFormError("Owner is required.");
    if (!form.dueDate) return setFormError("Target completion date is required.");
    if (!form.metricName.trim()) return setFormError("Success metric / KPI is required.");
    if (form.targetValue.trim() !== "" && Number.isNaN(Number(form.targetValue))) {
      return setFormError("Target value must be a number.");
    }
    if (form.baselineValue.trim() !== "" && Number.isNaN(Number(form.baselineValue))) {
      return setFormError("Baseline value must be a number.");
    }
    if (!formRendererRef.current?.validate()) {
      setFormError("Some fields need attention before this can be saved.");
      return;
    }
    saveMutation.mutate();
  }

  if (isEditing && loading) {
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
            aria-label="Back to Business Objectives"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-secondary hover:bg-slate-50 hover:text-primary"
            onClick={backToList}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="shell-page-header-title text-xl">
            {isEditing ? "Edit Business Objective" : "Add Business Objective"}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={backToList}>
            Cancel
          </Button>
          <Button isLoading={saveMutation.isPending} onClick={handleSubmit}>
            {isEditing ? "Save changes" : "Add objective"}
          </Button>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 px-8 py-8 lg:grid-cols-[1fr_320px]">
        <Card className="space-y-5 p-6">
          {formError && <div className="banner-error">{formError}</div>}

          <BoFieldContext.Provider value={boFieldContextValue}>
            <FormRenderer
              ref={formRendererRef}
              form={effectiveForm}
              values={rendererValues}
              onChange={handleFieldChange}
              onSubmit={() => {}}
              errors={customFieldErrors}
              fieldRenderers={BUSINESS_OBJECTIVE_FIELD_RENDERERS}
              hideActions
              subdomain={subdomain}
            />
          </BoFieldContext.Provider>
        </Card>

        <Card className="h-fit space-y-4 p-6">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-cta" />
            <h2 className="text-base font-semibold text-primary">Strategic Context</h2>
          </div>
          <p className="text-sm text-secondary">
            Company objectives set the direction for the organization — they shape how teams
            prioritize their work and where resources go each quarter.
          </p>
          <p className="text-sm text-secondary">
            <span className="font-medium text-primary">Training alignment:</span> when a training
            request is submitted, it should map to one of these active objectives, so L&amp;D
            investment can be traced back to a measurable business outcome.
          </p>
          <div className="banner-info">
            <p className="mb-1.5 font-medium">Best practices</p>
            <ul className="list-disc space-y-1 pl-4">
              <li>Keep titles specific and actionable.</li>
              <li>Make the success metric measurable, not aspirational.</li>
              <li>Review active objectives regularly to keep them relevant.</li>
            </ul>
          </div>
        </Card>
      </main>
    </div>
  );
}
