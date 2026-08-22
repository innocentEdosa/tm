"use client";

// No-login magic-link landing page — reached directly from the assignment-notification email
// (tenant-tna-routes.ts's `notifyTnaParticipants`), never through a logged-in session. Mirrors
// tna-my-response-client.tsx's UI (the session-authenticated equivalent, at
// (tna-response-editor)/strategy/training-needs-analysis/my/[assignmentId] — its own full-screen
// route group, no dashboard-shell sidebar) but talks to the public, token-authenticated
// `/public/tna-assignments*` routes with plain `fetch` (no `credentials: "include"`, no
// `tenantFetch` helper) and gets its `EffectiveForm` bundled directly into the GET response rather
// than via `useEffectiveForm` (which requires a session).
import { createContext, useContext, useEffect, useRef, useState, type ComponentType } from "react";
import { Card, Badge, Button } from "@tm/ui";
import { ChevronDown, Plus, Users } from "lucide-react";
import {
  FormRenderer,
  type EffectiveForm,
  type FormField,
  type FormRendererHandle,
  type FieldRendererProps,
  type PersonOrRoleSelection,
} from "@tm/form-builder";

const API_BASE = "/tenant-api/public";

interface BusinessObjectiveOption {
  id: string;
  title: string;
}

/** Backs the `business_objective` (`entity_select`) and `affected_individuals` (`people_select`)
 * fields on this form — both need the raw magic-link token to reach their own token-scoped
 * `/public/tna-assignments/*` search endpoints (no session exists here to reach the normal
 * session-authenticated equivalents `EntitySelectField`/`PeopleSelectField` ship with by
 * default), so this context threads `token`/`subdomain` down the same way `TnaFieldContext` does
 * for the session-authenticated Training Request form (spec FR-029 — a consuming feature
 * supplies its own rendering for a specific field key). */
const TnaResponseFieldContext = createContext<{ token: string; subdomain: string } | null>(null);

function useTnaResponseFieldContext() {
  const ctx = useContext(TnaResponseFieldContext);
  if (!ctx) throw new Error("TNA response field renderers must be used inside TnaResponseFieldContext");
  return ctx;
}

function BusinessObjectiveField({ field, value, onChange, error, readOnly }: FieldRendererProps) {
  const { token, subdomain } = useTnaResponseFieldContext();
  const [options, setOptions] = useState<BusinessObjectiveOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/tna-assignments/business-objectives?${new URLSearchParams({ token, subdomain })}`)
      .then((res) => res.json())
      .then((json: { data: BusinessObjectiveOption[] }) => {
        if (!cancelled) setOptions(json.data ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token, subdomain]);

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

function AffectedIndividualsField({ field, value, onChange, error, readOnly }: FieldRendererProps) {
  const { token, subdomain } = useTnaResponseFieldContext();
  const selected = (value as PersonOrRoleSelection[] | undefined) ?? [];
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonOrRoleSelection[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`${API_BASE}/tna-assignments/people-search?${new URLSearchParams({ token, subdomain, search: trimmed })}`);
      const json = (await res.json()) as { data: PersonOrRoleSelection[] };
      setResults(json.data ?? []);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, token, subdomain]);

  function handleSelect(entry: PersonOrRoleSelection) {
    if (!selected.some((s) => s.type === entry.type && s.id === entry.id)) {
      onChange([...selected, entry]);
    }
    setQuery("");
    setResults([]);
    setIsOpen(false);
  }

  function handleRemove(entry: PersonOrRoleSelection) {
    onChange(selected.filter((s) => !(s.type === entry.type && s.id === entry.id)));
  }

  return (
    <div className="relative">
      <label className="field-label">
        {field.label}
        {field.isRequired ? " *" : ""}
      </label>
      {field.description && <p className="field-hint">{field.description}</p>}
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((entry) => (
            <span key={`${entry.type}:${entry.id}`} className="inline-flex items-center gap-1 rounded-full border border-border bg-white px-2.5 py-1 text-xs text-primary">
              {entry.label}
              <span className="text-slate-400">({entry.type === "user" ? "person" : "role"})</span>
              {!readOnly && (
                <button type="button" className="cursor-pointer text-slate-400 hover:text-red-600" onClick={() => handleRemove(entry)}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {!readOnly && (
        <>
          <input
            className="field-input"
            placeholder={field.placeholder ?? "Search people or roles…"}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            onBlur={() => setTimeout(() => setIsOpen(false), 150)}
          />
          {isOpen && results.length > 0 && (
            <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-white shadow-lg">
              {results.map((r) => (
                <button
                  key={`${r.type}:${r.id}`}
                  type="button"
                  className="block w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(r)}
                >
                  {r.label} {r.sublabel && <span className="text-slate-400">({r.sublabel})</span>}
                  <span className="ml-1 text-xs text-slate-400">{r.type === "user" ? "· person" : "· role"}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

const TNA_RESPONSE_FIELD_RENDERERS: Record<string, ComponentType<FieldRendererProps>> = {
  business_objective: BusinessObjectiveField,
  affected_individuals: AffectedIndividualsField,
  development_beneficiaries: AffectedIndividualsField,
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
  form: EffectiveForm | null;
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
 * admin review drawer's and the session-authenticated equivalent's own picks
 * (tna-exercise-detail-client.tsx, tna-my-response-client.tsx) so every "view a response" UI looks
 * the same regardless of which one a person lands on: the badge is the first answered select/radio
 * field (Priority); the title is Skill Gap; the stat is Employees Affected's selection count; the
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
  return Array.isArray(value) ? value.length : null;
}

function findField(fields: FormField[], fieldKey: string): FormField | null {
  return fields.find((f) => f.fieldKey === fieldKey) ?? null;
}

async function parseJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** A department can have more than one training need, so one assignment can hold any number of
 * responses — not just one, mirrored from tna-my-response-client.tsx. See that file's own doc
 * comment for the "auto-start the first response, require an explicit click for every one after
 * that" shape this follows. */
export default function TnaResponseForm({ subdomain, token }: { subdomain: string; token: string }) {
  const formRendererRef = useRef<FormRendererHandle>(null);
  const autoStartAttempted = useRef(false);

  const [assignment, setAssignment] = useState<AssignmentDetail | null>(null);
  const [activeResponseId, setActiveResponseId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingDraft, setSavingDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [starting, setStarting] = useState(false);
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

  function qs(extra?: Record<string, string>) {
    const params = new URLSearchParams({ token, subdomain, ...extra });
    return params.toString();
  }

  // Resolves Business Objective's stored id to its title for the collapsed card's highlight —
  // same public endpoint `BusinessObjectiveField` above uses.
  const [objectiveTitleById, setObjectiveTitleById] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!token || !subdomain) return;
    fetch(`${API_BASE}/tna-assignments/business-objectives?${new URLSearchParams({ token, subdomain })}`)
      .then((res) => res.json())
      .then((json: { data: BusinessObjectiveOption[] }) => {
        setObjectiveTitleById(new Map((json.data ?? []).map((o) => [o.id, o.title])));
      })
      .catch(() => {});
  }, [token, subdomain]);

  async function load() {
    if (!token || !subdomain) {
      setLoadError("This link is invalid.");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/tna-assignments?${qs()}`);
      if (!res.ok) {
        const json = await parseJson<{ message?: string }>(res).catch(() => null);
        setLoadError(json?.message ?? "This link is invalid or has expired.");
        setLoading(false);
        return;
      }
      const { data } = await parseJson<{ data: AssignmentDetail }>(res);
      setAssignment(data);
      const draft = data.responses.find((r) => r.status === "draft");
      if (draft) {
        setActiveResponseId(draft.id);
        setValues(draft.values);
      } else {
        setActiveResponseId(null);
        setValues({});
        if (data.responses.length === 0 && data.exerciseStatus === "active" && !autoStartAttempted.current) {
          autoStartAttempted.current = true;
          await startResponse();
        }
      }
      setLoadError(null);
    } catch {
      setLoadError("Couldn't reach the server. Try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, subdomain]);

  function handleChange(fieldKey: string, value: unknown) {
    setValues((v) => ({ ...v, [fieldKey]: value }));
  }

  async function startResponse() {
    setFormError(null);
    setStarting(true);
    try {
      const res = await fetch(`${API_BASE}/tna-assignments/responses?${qs()}`, { method: "POST" });
      if (!res.ok) {
        const json = await parseJson<{ message?: string }>(res).catch(() => null);
        setFormError(json?.message ?? "Couldn't start a new response. Try again.");
        return;
      }
      const { data } = await parseJson<{ data: TnaResponseSummary }>(res);
      setActiveResponseId(data.id);
      setValues({});
      setErrors({});
      await load();
    } catch {
      setFormError("Couldn't reach the server. Try again.");
    } finally {
      setStarting(false);
    }
  }

  async function handleSaveDraft() {
    setFormError(null);
    setSavingDraft(true);
    try {
      const res = await fetch(`${API_BASE}/tna-assignments/responses/${activeResponseId}?${qs()}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values }),
      });
      if (!res.ok) {
        const json = await parseJson<{ message?: string }>(res).catch(() => null);
        setFormError(json?.message ?? "Couldn't save your progress. Try again.");
        return;
      }
    } catch {
      setFormError("Couldn't reach the server. Try again.");
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleSubmit() {
    setFormError(null);
    if (!formRendererRef.current?.validate()) {
      setFormError("Some fields need attention before this can be submitted.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/tna-assignments/responses/${activeResponseId}/submit?${qs()}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values }),
      });
      if (!res.ok) {
        const json = await parseJson<{ message?: string; errors?: { fieldKey: string; message: string }[] }>(res).catch(() => null);
        if (json?.errors) {
          setErrors(Object.fromEntries(json.errors.map((e) => [e.fieldKey, e.message])));
          setFormError("Some fields need attention before this can be submitted.");
          return;
        }
        setFormError(json?.message ?? "Couldn't submit your response. Try again.");
        return;
      }
      setErrors({});
      await load();
    } catch {
      setFormError("Couldn't reach the server. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl px-8 py-8">
        <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
      </main>
    );
  }

  if (loadError || !assignment) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12 text-center">
        <div className="banner-error">{loadError ?? "This link is invalid or has expired."}</div>
      </main>
    );
  }

  const canRespond = assignment.exerciseStatus === "active";
  const submittedResponses = assignment.responses.filter((r) => r.status === "submitted");
  const fields = assignment.form?.steps.flatMap((s) => s.sections.flatMap((sec) => sec.fields)) ?? [];
  const isEditing = !!activeResponseId;
  const hasResponded = assignment.status === "submitted";

  return (
    <main className="mx-auto max-w-3xl px-8 py-8">
      <div className="flex items-center gap-3">
        <h1 className="shell-page-header-title text-xl">{assignment.exerciseTitle}</h1>
        <Badge variant={hasResponded ? "success" : "warning"}>{hasResponded ? "Submitted" : "Pending"}</Badge>
      </div>
      {assignment.exerciseDescription && <p className="mt-1.5 text-sm text-slate-600">{assignment.exerciseDescription}</p>}
      <p className="mt-2 text-xs text-slate-500">
        {assignment.departmentName && <>Department: {assignment.departmentName} · </>}
        Deadline: {formatDate(assignment.endDate)} · Exercise status: {STATUS_LABEL[assignment.exerciseStatus]}
      </p>

      {formError && <div className="banner-error mt-6">{formError}</div>}
      {!canRespond && (
        <div className="banner-error mt-6">This Training Needs Analysis is not currently accepting responses.</div>
      )}

      {submittedResponses.map((response, index) => {
        const isExpanded = expandedIds.has(response.id);
        const badgeField = pickBadgeField(fields, response.values);
        const employeesAffected = pickEmployeesAffectedCount(fields, response.values);
        const skillGapField = findField(fields, "skill_gap");
        const skillGapValue = skillGapField ? response.values[skillGapField.fieldKey] : undefined;
        const title = typeof skillGapValue === "string" && skillGapValue.trim() !== "" ? skillGapValue : `Response ${index + 1}`;
        const objectiveField = findField(fields, "business_objective");
        const objectiveValue = objectiveField ? response.values[objectiveField.fieldKey] : undefined;
        const objectiveTitle = typeof objectiveValue === "string" ? (objectiveTitleById.get(objectiveValue) ?? objectiveValue) : null;

        return (
          <Card key={response.id} className="mt-6 overflow-hidden border-l-4 border-l-amber-400 p-0">
            <button
              type="button"
              className="flex w-full cursor-pointer items-center justify-between gap-4 p-3 text-left"
              onClick={() => toggleExpanded(response.id)}
              aria-expanded={isExpanded}
            >
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-primary">{title}</h2>
                {response.submittedAt && <p className="text-xs text-slate-500">Submitted {formatDateTime(response.submittedAt)}</p>}
                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                  {badgeField && <Badge variant="warning">{String(response.values[badgeField.fieldKey])}</Badge>}
                  {employeesAffected !== null && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                      <Users className="h-3.5 w-3.5" />
                      {employeesAffected} employees affected
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                {objectiveTitle && !isExpanded && (
                  <div className="hidden text-right sm:block">
                    <p className="text-xs text-slate-500">Business objective</p>
                    <p className="text-sm font-semibold text-primary">{objectiveTitle}</p>
                  </div>
                )}
                <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
              </div>
            </button>
            {isExpanded && (
              <div className="border-t border-border p-6">
                <TnaResponseFieldContext.Provider value={{ token, subdomain }}>
                  <FormRenderer
                    form={assignment.form}
                    values={response.values}
                    onChange={() => {}}
                    onSubmit={() => {}}
                    fieldRenderers={TNA_RESPONSE_FIELD_RENDERERS}
                    readOnly
                    hideActions
                    subdomain={subdomain}
                  />
                </TnaResponseFieldContext.Provider>
              </div>
            )}
          </Card>
        );
      })}

      {isEditing && (
        <Card className="mt-6 p-6">
          <h2 className="mb-4 text-sm font-semibold text-primary">{submittedResponses.length > 0 ? "New response" : "Your response"}</h2>
          <TnaResponseFieldContext.Provider value={{ token, subdomain }}>
            <FormRenderer
              ref={formRendererRef}
              form={assignment.form}
              values={values}
              onChange={handleChange}
              onSubmit={() => {}}
              errors={errors}
              fieldRenderers={TNA_RESPONSE_FIELD_RENDERERS}
              hideActions
              subdomain={subdomain}
            />
          </TnaResponseFieldContext.Provider>
          <div className="mt-8 flex justify-end gap-2 border-t border-border pt-6">
            <Button variant="secondary" isLoading={savingDraft} disabled={!canRespond} onClick={handleSaveDraft}>
              Save draft
            </Button>
            <Button isLoading={submitting} disabled={!canRespond} onClick={handleSubmit}>
              Submit
            </Button>
          </div>
        </Card>
      )}

      {!isEditing && canRespond && (
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" isLoading={starting} onClick={() => startResponse()}>
            <Plus className="h-4 w-4" />
            {submittedResponses.length > 0 ? "Add another response" : "Start your response"}
          </Button>
        </div>
      )}
    </main>
  );
}
