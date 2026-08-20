"use client";

// No-login magic-link landing page — reached directly from the assignment-notification email
// (tenant-tna-routes.ts's `notifyTnaParticipants`), never through a logged-in session. Mirrors
// tna-my-response-client.tsx's UI (the session-authenticated equivalent, at
// (tna-response-editor)/strategy/training-needs-analysis/my/[assignmentId] — its own full-screen
// route group, no dashboard-shell sidebar) but talks to the public, token-authenticated
// `/public/tna-assignments*` routes with plain `fetch` (no `credentials: "include"`, no
// `tenantFetch` helper) and gets its `EffectiveForm` bundled directly into the GET response rather
// than via `useEffectiveForm` (which requires a session).
import { useEffect, useRef, useState } from "react";
import { Card, Badge, Button } from "@tm/ui";
import { FormRenderer, type EffectiveForm, type FormRendererHandle } from "@tm/form-builder";

const API_BASE = "/tenant-api/public";

type ExerciseStatus = "draft" | "active" | "closed" | "under_review" | "committed";

const STATUS_LABEL: Record<ExerciseStatus, string> = {
  draft: "Draft",
  active: "Active",
  closed: "Closed",
  under_review: "Under Review",
  committed: "Committed",
};

interface AssignmentDetail {
  id: string;
  departmentName: string | null;
  status: "pending" | "submitted";
  submittedAt: string | null;
  exerciseTitle: string;
  exerciseDescription: string | null;
  exerciseStatus: ExerciseStatus;
  endDate: string;
  responseValues: Record<string, unknown>;
  form: EffectiveForm | null;
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

async function parseJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export default function TnaResponseForm({ subdomain, token }: { subdomain: string; token: string }) {
  const formRendererRef = useRef<FormRendererHandle>(null);

  const [assignment, setAssignment] = useState<AssignmentDetail | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingDraft, setSavingDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    if (!token || !subdomain) {
      setLoadError("This link is invalid.");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/tna-assignments?token=${encodeURIComponent(token)}&subdomain=${encodeURIComponent(subdomain)}`);
      if (!res.ok) {
        const json = await parseJson<{ message?: string }>(res).catch(() => null);
        setLoadError(json?.message ?? "This link is invalid or has expired.");
        setLoading(false);
        return;
      }
      const { data } = await parseJson<{ data: AssignmentDetail }>(res);
      setAssignment(data);
      setValues(data.responseValues ?? {});
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

  async function handleSaveDraft() {
    setFormError(null);
    setSavingDraft(true);
    try {
      const res = await fetch(`${API_BASE}/tna-assignments?token=${encodeURIComponent(token)}&subdomain=${encodeURIComponent(subdomain)}`, {
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
      const res = await fetch(`${API_BASE}/tna-assignments/submit?token=${encodeURIComponent(token)}&subdomain=${encodeURIComponent(subdomain)}`, {
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
      await load();
    } catch {
      setFormError("Couldn't reach the server. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-8 py-8">
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

  const isReadOnly = assignment.status === "submitted";
  const canRespond = assignment.exerciseStatus === "active";

  return (
    <main className="mx-auto max-w-3xl px-8 py-8">
      <div className="flex items-center gap-3">
        <h1 className="shell-page-header-title text-xl">{assignment.exerciseTitle}</h1>
        <Badge variant={isReadOnly ? "success" : "warning"}>{isReadOnly ? "Submitted" : "Pending"}</Badge>
      </div>
      {assignment.exerciseDescription && <p className="mt-1.5 text-sm text-slate-600">{assignment.exerciseDescription}</p>}
      <p className="mt-2 text-xs text-slate-500">
        {assignment.departmentName && <>Department: {assignment.departmentName} · </>}
        Deadline: {formatDate(assignment.endDate)} · Exercise status: {STATUS_LABEL[assignment.exerciseStatus]}
      </p>

      <Card className="mt-6 p-6">
        {formError && <div className="banner-error mb-4">{formError}</div>}
        {isReadOnly && <div className="banner-success mb-4">Thanks — your response has been submitted.</div>}
        {!isReadOnly && !canRespond && (
          <div className="banner-error mb-4">This Training Needs Analysis is not currently accepting responses.</div>
        )}

        <FormRenderer
          ref={formRendererRef}
          form={assignment.form}
          values={values}
          onChange={handleChange}
          onSubmit={() => {}}
          errors={errors}
          readOnly={isReadOnly}
          hideActions
          subdomain={subdomain}
        />

        {!isReadOnly && (
          <div className="mt-8 flex justify-end gap-2 border-t border-border pt-6">
            <Button variant="secondary" isLoading={savingDraft} disabled={!canRespond} onClick={handleSaveDraft}>
              Save draft
            </Button>
            <Button isLoading={submitting} disabled={!canRespond} onClick={handleSubmit}>
              Submit
            </Button>
          </div>
        )}
      </Card>
    </main>
  );
}
