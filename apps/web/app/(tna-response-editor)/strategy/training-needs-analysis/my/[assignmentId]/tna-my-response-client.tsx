"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Card, Badge, Button } from "@tm/ui";
import { FormRenderer, useEffectiveForm, type FormRendererHandle } from "@tm/form-builder";
import { tenantFetch } from "@/lib/tenant-api-client";

const API_BASE = "/tenant-api/tenant";
const FORM_KEY = "tna_response";

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
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** No `fieldRenderers` map needed here at all — every `tna_response` field is an ordinary,
 * tenant-editable Form Builder field (0144_register_tna_response_form_type.sql), so `values`/
 * `onChange` flow straight through `FormRenderer`'s own generic props, unlike Business
 * Objectives'/Training Request's own system-field override pattern. */
export default function TnaMyResponseClient({ subdomain, assignmentId }: { subdomain: string; assignmentId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const formRendererRef = useRef<FormRendererHandle>(null);

  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const { form: effectiveForm } = useEffectiveForm(FORM_KEY, subdomain);

  const assignmentQuery = useQuery({
    queryKey: ["tna-my-assignment", assignmentId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: AssignmentDetail }>(`/tna-assignments/${assignmentId}`, { subdomain });
      return data;
    },
    retry: false,
  });

  useEffect(() => {
    if (assignmentQuery.data) setValues(assignmentQuery.data.responseValues ?? {});
  }, [assignmentQuery.data]);

  useEffect(() => {
    if (assignmentQuery.error) setFormError((assignmentQuery.error as Error).message);
  }, [assignmentQuery.error]);

  function handleChange(fieldKey: string, value: unknown) {
    setValues((v) => ({ ...v, [fieldKey]: value }));
  }

  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      await tenantFetch(`/tna-assignments/${assignmentId}`, { method: "PATCH", body: { values }, subdomain });
    },
    onSuccess: () => {
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ["tna-my-assignment", assignmentId, subdomain] });
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/tna-assignments/${assignmentId}/submit?subdomain=${encodeURIComponent(subdomain)}`, {
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
      queryClient.invalidateQueries({ queryKey: ["tna-my-assignment", assignmentId, subdomain] });
      queryClient.invalidateQueries({ queryKey: ["my-tna-assignments", subdomain] });
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

  const assignment = assignmentQuery.data;
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
        <main className="mx-auto w-full max-w-3xl px-8 py-8">
          <div className="banner-error">This Training Needs Analysis assignment couldn&apos;t be found.</div>
        </main>
      </div>
    );
  }

  const isReadOnly = assignment.status === "submitted";
  const canRespond = assignment.exerciseStatus === "active";

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
              <h1 className="shell-page-header-title text-xl">{assignment.exerciseTitle}</h1>
              <Badge variant={isReadOnly ? "success" : "warning"}>{isReadOnly ? "Submitted" : "Pending"}</Badge>
            </div>
          </div>
        </div>
        {!isReadOnly && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={backToList}>
              Cancel
            </Button>
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
        )}
      </header>

      <main className="mx-auto w-full max-w-3xl px-8 py-8">
        {assignment.exerciseDescription && <p className="text-sm text-slate-600">{assignment.exerciseDescription}</p>}
        <p className="mt-2 text-xs text-slate-500">
          {assignment.departmentName && <>Department: {assignment.departmentName} · </>}
          Deadline: {formatDate(assignment.endDate)} · Exercise status: {STATUS_LABEL[assignment.exerciseStatus]}
        </p>

        <Card className="mt-6 p-6">
          {formError && <div className="banner-error mb-4">{formError}</div>}
          {!isReadOnly && !canRespond && (
            <div className="banner-error mb-4">This Training Needs Analysis is not currently accepting responses.</div>
          )}

          <FormRenderer
            ref={formRendererRef}
            form={effectiveForm}
            values={values}
            onChange={handleChange}
            onSubmit={() => {}}
            errors={errors}
            readOnly={isReadOnly}
            hideActions
            subdomain={subdomain}
          />
        </Card>
      </main>
    </div>
  );
}
