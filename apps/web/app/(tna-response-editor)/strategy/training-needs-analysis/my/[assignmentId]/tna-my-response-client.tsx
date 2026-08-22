"use client";

import { createContext, useContext, useEffect, useRef, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, Plus, Target, Users } from "lucide-react";
import { Card, Badge, Button } from "@tm/ui";
import {
  FormRenderer,
  resolveFormIcon,
  useEffectiveForm,
  type FieldRendererProps,
  type FormField,
  type FormIconName,
  type FormRendererHandle,
} from "@tm/form-builder";
import { tenantFetch } from "@/lib/tenant-api-client";

const API_BASE = "/tenant-api/tenant";
const FORM_KEY = "tna_response";

interface BusinessObjectiveOption {
  id: string;
  title: string;
}

/** Threads `subdomain` down to `BusinessObjectiveField` below, mirroring `TnaResponseFieldContext`
 * in the public magic-link equivalent (tna-response/tna-response-form.tsx). */
const SubdomainContext = createContext<string | null>(null);

/** `entity_select`'s own default renderer (`EntitySelectField` in `@tm/form-builder`) is only a
 * static-options fallback with no dynamic fetch (unlike `people_select`, which already defaults to
 * hitting `/tenant/forms/people-search` whenever `subdomain` is passed to `<FormRenderer>`) — so
 * `business_objective` is the one `tna_response` field that still needs its own `fieldRenderers`
 * override here, mirrored from the public magic-link equivalent's `BusinessObjectiveField`
 * (tna-response/tna-response-form.tsx) but using `tenantFetch` against the session-authenticated
 * `GET /tenant/tna-assignments/business-objectives` instead of the token-based public route. */
function BusinessObjectiveField({ field, value, onChange, error, readOnly }: FieldRendererProps) {
  const subdomain = useContext(SubdomainContext)!;
  const { data } = useQuery({
    queryKey: ["tna-response-business-objectives", subdomain],
    queryFn: () => tenantFetch<{ data: BusinessObjectiveOption[] }>("/tna-assignments/business-objectives", { subdomain }),
  });
  const options = data?.data ?? [];

  return (
    <div>
      <label className="field-label">
        {field.label}
        {field.isRequired ? " *" : ""}
      </label>
      {field.description && <p className="field-hint">{field.description}</p>}
      <select className={`field-input ${value ? "" : "text-slate-400"}`} disabled={readOnly} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled hidden>
          {field.placeholder || "Select a business objective"}
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.title}
          </option>
        ))}
      </select>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

const TNA_RESPONSE_FIELD_RENDERERS: Record<string, ComponentType<FieldRendererProps>> = {
  business_objective: BusinessObjectiveField,
};

type ExerciseStatus = "draft" | "active" | "closed" | "under_review" | "committed";

const STATUS_LABEL: Record<ExerciseStatus, string> = {
  draft: "Draft",
  active: "Active",
  closed: "Closed",
  under_review: "Under Review",
  committed: "Committed",
};

interface TnaResponseSummary {
  id: string;
  status: "draft" | "submitted";
  submittedAt: string | null;
  createdAt: string;
  values: Record<string, unknown>;
}

interface AssignmentDetail {
  id: string;
  departmentName: string | null;
  status: "pending" | "submitted";
  submittedAt: string | null;
  exerciseTitle: string;
  exerciseDescription: string | null;
  exerciseStatus: ExerciseStatus;
  endDate: string;
  responses: TnaResponseSummary[];
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const datePart = date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const timePart = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${datePart} · ${timePart}`;
}

/** Picks which fields summarize a submitted response in its collapsed card header — mirrors the
 * admin review drawer's own picks (tna-exercise-detail-client.tsx) so a participant's own response
 * list and HR's review of it look the same: the badge is the first answered select/radio field
 * (Priority); the title is Skill Gap; the stat is Employees Affected's selection count; the
 * highlight is Business Objective. */
function pickBadgeField(fields: FormField[], values: Record<string, unknown>): FormField | null {
  return fields.find((f) => (f.fieldType === "select" || f.fieldType === "radio") && !!values[f.fieldKey]) ?? null;
}

/** `affected_individuals` (relabeled "Employees Affected") is a `people_select` — its "count" is
 * how many people/roles were picked, not a `number` field's own value (this form has none). */
function pickEmployeesAffectedCount(fields: FormField[], values: Record<string, unknown>): number | null {
  const field = fields.find((f) => f.fieldKey === "affected_individuals");
  if (!field) return null;
  const value = values[field.fieldKey];
  // Always show once the field exists on the form — older responses submitted before this field
  // was answered have no value at all, and should read as "0 employees affected" rather than
  // silently disappearing from the card.
  return Array.isArray(value) ? value.length : 0;
}

function findField(fields: FormField[], fieldKey: string): FormField | null {
  return fields.find((f) => f.fieldKey === fieldKey) ?? null;
}

/** Color-codes the badge field's value (Priority, in practice) by severity word rather than a
 * flat color for every value — case-insensitive since it's free-text options on a `radio` field,
 * not a fixed enum, so a tenant could type "low"/"Low"/"LOW" interchangeably. Anything unrecognized
 * (a custom option a tenant added) falls back to neutral rather than guessing. */
function priorityBadgeVariant(value: string): "success" | "warning" | "neutral" | "danger" {
  switch (value.trim().toLowerCase()) {
    case "low":
      return "success";
    case "medium":
      return "warning";
    case "high":
    case "critical":
      return "danger";
    default:
      return "neutral";
  }
}

/** Renders a field's stored value as plain display text for the expanded card's detail grid —
 * `people_select` joins the selected people/roles' names (its raw value is an array of
 * `{ type, id, label, sublabel? }` objects, so `String()` alone would read `[object Object]`),
 * `entity_select` (Business Objective) resolves its stored id through `objectiveTitleById`, and
 * every other field type already stringifies correctly on its own. */
function formatFieldValue(fieldType: string, value: unknown, objectiveTitleById: Map<string, string>): string {
  if (value === undefined || value === null || value === "") return "Not set";
  if (fieldType === "people_select" && Array.isArray(value)) {
    const labels = (value as { label?: string }[]).map((entry) => entry?.label).filter((label): label is string => !!label);
    return labels.length > 0 ? labels.join(", ") : "Not set";
  }
  if (fieldType === "entity_select" && typeof value === "string") {
    return objectiveTitleById.get(value) ?? value;
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** A reasonable icon per `fieldType` for the expanded card's detail grid — this form has no
 * per-field icon of its own (only form *sections* carry one, via `resolveFormIcon`), so this picks
 * from the same curated `FORM_ICONS` set by the shape of the field's answer instead. */
function fieldIconName(fieldType: string): FormIconName {
  switch (fieldType) {
    case "select":
    case "radio":
      return "flag";
    case "multiselect":
      return "layers";
    case "people_select":
      return "users";
    case "entity_select":
      return "target";
    case "number":
      return "clipboardList";
    case "date":
    case "datetime":
      return "clock";
    case "checkbox":
    case "toggle":
      return "checkCircle";
    default:
      return "fileText";
  }
}

/** Every `tna_response` field is an ordinary, tenant-editable Form Builder field except
 * `business_objective` (an `entity_select` added to the form via the Form Builder), which needs
 * the `BusinessObjectiveField` override above since `entity_select` has no dynamic-fetch default
 * renderer.
 *
 * A department can have more than one training need, so one assignment can hold any number of
 * responses (`tna_responses`, one row per submission) — not just one. The first response is
 * auto-started so the page still opens straight into a blank form like before; every response after
 * that requires an explicit "Add another response" click, and at most one response is ever being
 * edited (`draft`) at a time. */
export default function TnaMyResponseClient({ subdomain, assignmentId }: { subdomain: string; assignmentId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const formRendererRef = useRef<FormRendererHandle>(null);
  const autoStartAttempted = useRef(false);

  const [activeResponseId, setActiveResponseId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // Every submitted response opens collapsed to its summary card — expanded only on request,
  // mirroring the admin review drawer's own default.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const { form: effectiveForm } = useEffectiveForm(FORM_KEY, subdomain);
  const fields = effectiveForm?.steps.flatMap((s) => s.sections.flatMap((sec) => sec.fields)) ?? [];

  // Resolves Business Objective's stored id to its title for the collapsed card's highlight —
  // same source `BusinessObjectiveField` above uses.
  const objectivesQuery = useQuery({
    queryKey: ["tna-response-business-objectives", subdomain],
    queryFn: () => tenantFetch<{ data: BusinessObjectiveOption[] }>("/tna-assignments/business-objectives", { subdomain }),
  });
  const objectiveTitleById = new Map((objectivesQuery.data?.data ?? []).map((o) => [o.id, o.title]));

  const assignmentQuery = useQuery({
    queryKey: ["tna-my-assignment", assignmentId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: AssignmentDetail }>(`/tna-assignments/${assignmentId}`, { subdomain });
      return data;
    },
    retry: false,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["tna-my-assignment", assignmentId, subdomain] });
    queryClient.invalidateQueries({ queryKey: ["my-tna-assignments", subdomain] });
  }

  const startResponseMutation = useMutation({
    mutationFn: async () => {
      const { data } = await tenantFetch<{ data: TnaResponseSummary }>(`/tna-assignments/${assignmentId}/responses`, {
        method: "POST",
        subdomain,
      });
      return data;
    },
    onSuccess: (data) => {
      setFormError(null);
      setErrors({});
      setActiveResponseId(data.id);
      setValues({});
      invalidate();
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const assignment = assignmentQuery.data;

  useEffect(() => {
    if (!assignment) return;
    const draft = assignment.responses.find((r) => r.status === "draft");
    if (draft) {
      setActiveResponseId(draft.id);
      setValues(draft.values);
      return;
    }
    setActiveResponseId(null);
    if (assignment.responses.length === 0 && assignment.exerciseStatus === "active" && !autoStartAttempted.current) {
      autoStartAttempted.current = true;
      startResponseMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment]);

  function handleChange(fieldKey: string, value: unknown) {
    setValues((v) => ({ ...v, [fieldKey]: value }));
  }

  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      await tenantFetch(`/tna-assignments/${assignmentId}/responses/${activeResponseId}`, { method: "PATCH", body: { values }, subdomain });
    },
    onSuccess: () => {
      setFormError(null);
      invalidate();
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/tna-assignments/${assignmentId}/responses/${activeResponseId}/submit?subdomain=${encodeURIComponent(subdomain)}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as
          | { message?: string; errors?: { fieldKey: string; message: string }[] }
          | null;
        throw { json };
      }
    },
    onSuccess: () => {
      setFormError(null);
      setErrors({});
      invalidate();
    },
    onError: (err: { json?: { message?: string; errors?: { fieldKey: string; message: string }[] } | null }) => {
      const json = err?.json;
      if (json?.errors) {
        setErrors(Object.fromEntries(json.errors.map((e) => [e.fieldKey, e.message])));
        setFormError("Some fields need attention before this can be submitted.");
        return;
      }
      setFormError(json?.message ?? "Couldn't submit your response. Try again.");
    },
  });

  function handleSubmit() {
    setFormError(null);
    if (!formRendererRef.current?.validate()) {
      setFormError("Some fields need attention before this can be submitted.");
      return;
    }
    submitMutation.mutate();
  }

  function backToList() {
    router.push("/strategy/training-needs-analysis");
  }

  if (assignmentQuery.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
      </div>
    );
  }

  if (!assignment) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-white px-8 py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Back to Training Needs Analysis"
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-secondary hover:bg-slate-50 hover:text-primary"
              onClick={backToList}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="shell-page-header-title text-xl">Training Needs Analysis</h1>
          </div>
        </header>
        <main className="mx-auto w-full max-w-4xl px-8 py-8">
          <div className="banner-error">This Training Needs Analysis assignment couldn&apos;t be found.</div>
        </main>
      </div>
    );
  }

  const canRespond = assignment.exerciseStatus === "active";
  const submittedResponses = assignment.responses.filter((r) => r.status === "submitted");
  const isEditing = !!activeResponseId;
  const hasResponded = assignment.status === "submitted";

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-white px-8 py-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Back to Training Needs Analysis"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-secondary hover:bg-slate-50 hover:text-primary"
            onClick={backToList}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="shell-page-header-title text-xl capitalize">{assignment.exerciseTitle}</h1>
              <Badge variant={hasResponded ? "success" : "warning"}>{hasResponded ? "Submitted" : "Pending"}</Badge>
            </div>
          </div>
        </div>
        {isEditing ? (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              isLoading={saveDraftMutation.isPending}
              disabled={!canRespond}
              onClick={() => saveDraftMutation.mutate()}
            > 
              Save draft 
            </Button>
            <Button isLoading={submitMutation.isPending} disabled={!canRespond} onClick={handleSubmit}>
              Submit
            </Button>
          </div>
        ) : (
          canRespond && (
            <Button variant="secondary" isLoading={startResponseMutation.isPending} onClick={() => startResponseMutation.mutate()}>
              <Plus className="h-4 w-4" />
              {submittedResponses.length > 0 ? "Add another response" : "Start your response"}
            </Button>
          )
        )}
      </header>

      <main className="mx-auto w-full max-w-4xl px-8 py-8">
        {assignment.exerciseDescription && <p className="text-sm text-slate-600">{assignment.exerciseDescription}</p>}
        <p className="mt-2 text-xs text-slate-500">
          {assignment.departmentName && <>Department: {assignment.departmentName} · </>}
          Deadline: {formatDate(assignment.endDate)} · Exercise status: {STATUS_LABEL[assignment.exerciseStatus]}
        </p>

        {formError && <div className="banner-error mt-6">{formError}</div>}
        {!canRespond && (
          <div className="banner-error mt-6">This Training Needs Analysis is not currently accepting responses.</div>
        )}

        {isEditing && (
          <Card className="mt-6 p-6">
            <h2 className="mb-4 text-sm font-semibold text-primary">{submittedResponses.length > 0 ? "New response" : "Your response"}</h2>
            <SubdomainContext.Provider value={subdomain}>
              <FormRenderer
                ref={formRendererRef}
                form={effectiveForm}
                values={values}
                onChange={handleChange}
                onSubmit={() => {}}
                errors={errors}
                fieldRenderers={TNA_RESPONSE_FIELD_RENDERERS}
                hideActions
                subdomain={subdomain}
              />
            </SubdomainContext.Provider>
          </Card>
        )}

        {[...submittedResponses].reverse().map((response) => {
          // Numbered by original submission order (oldest = 1) even though the newest response
          // renders first — the number is a stable identifier for a response, not a display-order
          // index, so it shouldn't change depending on which one is newest.
          const number = submittedResponses.indexOf(response) + 1;
          const isExpanded = expandedIds.has(response.id);
          const badgeField = pickBadgeField(fields, response.values);
          const employeesAffected = pickEmployeesAffectedCount(fields, response.values);
          const skillGapField = findField(fields, "skill_gap");
          const skillGapValue = skillGapField ? response.values[skillGapField.fieldKey] : undefined;
          const title = typeof skillGapValue === "string" && skillGapValue.trim() !== "" ? skillGapValue : `Response ${number}`;
          const objectiveField = findField(fields, "business_objective");
          const objectiveValue = objectiveField ? response.values[objectiveField.fieldKey] : undefined;
          const objectiveTitle = typeof objectiveValue === "string" ? (objectiveTitleById.get(objectiveValue) ?? objectiveValue) : null;

          return (
            <Card key={response.id} className="mt-6 overflow-hidden border-l-4 border-l-amber-400 p-0 shadow-card-sm">
              <button
                type="button"
                className="flex w-full cursor-pointer items-center justify-between gap-4 px-3 py-1.5 text-left"
                onClick={() => toggleExpanded(response.id)}
                aria-expanded={isExpanded}
              >
                <div className="min-w-0">
                  <h2 className="text-sm leading-none font-semibold text-dark mb-2">{title}</h2>
                  {response.submittedAt && <p className="mt-0.5 mb-2 text-xs leading-none text-slate-700">Submitted {formatDateTime(response.submittedAt)}</p>}
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    {badgeField &&
                      (() => {
                        const badgeValue = String(response.values[badgeField.fieldKey]);
                        return <Badge variant={priorityBadgeVariant(badgeValue)}>{badgeValue}</Badge>;
                      })()}
                    {employeesAffected !== null && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                        <Users className="h-3.5 w-3.5" />
                        {employeesAffected} employees affected
                      </span>
                    )}
                  </div>
                </div>
                {objectiveTitle && !isExpanded && (
                  <div className="hidden shrink-0 items-center gap-3 sm:flex">
                    <div className="h-8 w-px bg-border" />
                    <div >
                      <p className="text-xs leading-none text-slate-500 mb-1">Business objective</p>
                      <p className="mt-0.5 text-sm leading-none font-semibold text-primary">{objectiveTitle}</p>
                    </div>
                  </div>
                )}
                <ChevronDown
                  className={`h-5 w-5 shrink-0 text-primary transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  strokeWidth={2}
                />
              </button>
              {isExpanded && (
                <div className=" border-border p-4">
                  {objectiveTitle && (
                    <div className="mb-3 flex items-start gap-3 rounded-xl bg-cta/5 p-4">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cta/10 text-cta">
                        <Target className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-primary">Business objective</p>
                        <p className="text-sm text-secondary">{objectiveTitle}</p>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-3">
                    {fields
                      .filter((field) => field.fieldKey !== "skill_gap")
                      .map((field) => {
                        const value = response.values[field.fieldKey];
                        const Icon = resolveFormIcon(fieldIconName(field.fieldType));
                        return (
                          <div key={field.fieldKey} className="rounded-xl bg-slate-50 p-4">
                            <div className="flex items-center gap-2">
                              {Icon && <Icon className="h-4 w-4 text-cta" />}
                              <p className="text-sm font-semibold text-primary">{field.label}</p>
                            </div>
                            <p className="mt-1 text-sm text-secondary">{formatFieldValue(field.fieldType, value, objectiveTitleById)}</p>
                          </div>
                        );
                      })}
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                    <p className="text-xs text-slate-500">Training Needs Analysis Form</p>
                    <button
                      type="button"
                      className="cursor-pointer text-xs font-medium text-cta hover:underline"
                      onClick={() => toggleExpanded(response.id)}
                    >
                      Collapse
                    </button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </main>
    </div>
  );
}
