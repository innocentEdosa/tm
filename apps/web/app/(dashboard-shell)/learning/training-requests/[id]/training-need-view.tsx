"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { PageHeader, Card, Badge, Button } from "@tm/ui";
import { STATUS_LABEL, STATUS_BADGE_VARIANT, type TrainingNeedStatus } from "../status";

const API_BASE = "/tenant-api/tenant";

type Priority = "low" | "medium" | "high";
type CustomFieldType = "text" | "textarea" | "number" | "date" | "select" | "multiselect";

const PRIORITY_LABEL: Record<Priority, string> = { low: "Low", medium: "Medium", high: "High" };
const PRIORITY_BADGE: Record<Priority, "neutral" | "warning" | "accent"> = {
  low: "neutral",
  medium: "warning",
  high: "accent",
};

interface CustomFieldDefinition {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: CustomFieldType;
  options: string[] | null;
  isRequired: boolean;
  isSystem: boolean;
}

interface TrainingNeedDetail {
  id: string;
  departmentId: string;
  departmentName: string | null;
  title: string;
  priority: Priority;
  status: TrainingNeedStatus;
  createdByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
}

/** Mirrors Department's own read-only `FieldValue` exactly (same classes) — an empty value reads as
 * a deliberate, described absence ("Not set") rather than a bare dash. */
function ViewField({ label, value, placeholder }: { label: string; value: React.ReactNode; placeholder: string }) {
  const isEmpty = value === null || value === undefined || value === "";
  return (
    <div>
      <p className="field-label">{label}</p>
      {isEmpty ? (
        <p className="text-sm italic text-slate-400">{placeholder}</p>
      ) : (
        <p className="text-sm text-secondary">{value}</p>
      )}
    </div>
  );
}

/**
 * Read-only detail page at `/learning/training-requests/[id]` — a dedicated page, not a Drawer (per direct
 * product feedback, matching the create/edit form's own move off Drawer). The entry's own title,
 * status, and priority surface as the page header; every tenant custom field renders below, in
 * `display_order`, exactly as configured in Settings > Forms.
 */
export default function TrainingNeedView({
  subdomain,
  trainingNeedId,
  canManage,
  canApprove,
}: {
  subdomain: string;
  trainingNeedId: string;
  canManage: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [approveError, setApproveError] = useState<string | null>(null);

  const entryQuery = useQuery({
    queryKey: ["training-need", trainingNeedId, subdomain],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/training-needs/${trainingNeedId}?subdomain=${encodeURIComponent(subdomain)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("This training request couldn't be found.");
      const json = (await res.json()) as { data: TrainingNeedDetail };
      return json.data;
    },
  });

  const customFieldsQuery = useQuery({
    queryKey: ["training-need-form-fields", subdomain],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/form-fields?formKey=training_needs_analysis&subdomain=${encodeURIComponent(subdomain)}`,
        { credentials: "include" },
      );
      const json = (res.ok ? await res.json() : { data: [] }) as { data: CustomFieldDefinition[] };
      return json.data.filter((f) => !f.isSystem);
    },
  });

  const customFieldValuesQuery = useQuery({
    queryKey: ["training-need-custom-field-values", trainingNeedId, subdomain],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/custom-field-values?formKey=training_needs_analysis&entityId=${trainingNeedId}&subdomain=${encodeURIComponent(subdomain)}`,
        { credentials: "include" },
      );
      const json = (res.ok ? await res.json() : { data: {} }) as { data: Record<string, unknown> };
      return json.data;
    },
  });

  const entry = entryQuery.data ?? null;
  const loading = entryQuery.isPending;
  const error = entryQuery.error ? (entryQuery.error as Error).message : null;
  const customFields = customFieldsQuery.data ?? [];
  const customFieldValues = customFieldValuesQuery.data ?? {};

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `${API_BASE}/training-needs/${trainingNeedId}/approve?subdomain=${encodeURIComponent(subdomain)}`,
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(json?.message ?? "Couldn't approve this training request. Try again.");
      }
    },
    onSuccess: () => {
      setApproveError(null);
      queryClient.invalidateQueries({ queryKey: ["training-need", trainingNeedId, subdomain] });
    },
    onError: (err: Error) => setApproveError(err.message),
  });

  function handleApprove() {
    setApproveError(null);
    approveMutation.mutate();
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

      {loading ? (
        <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
      ) : error || !entry ? (
        <div className="banner-error">{error ?? "This training request couldn't be found."}</div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <PageHeader title={entry.title} subtitle={entry.departmentName ?? undefined} />
              <Badge variant={STATUS_BADGE_VARIANT[entry.status]}>{STATUS_LABEL[entry.status]}</Badge>
              <Badge variant={PRIORITY_BADGE[entry.priority]}>{PRIORITY_LABEL[entry.priority]} priority</Badge>
            </div>
            <div className="flex shrink-0 gap-2">
              {canManage && (
                <Button variant="secondary" onClick={() => router.push(`/learning/training-requests/${trainingNeedId}/edit`)}>
                  Edit
                </Button>
              )}
              {canApprove && entry.status === "submitted" && (
                <Button isLoading={approveMutation.isPending} onClick={handleApprove}>
                  Approve
                </Button>
              )}
            </div>
          </div>

          {approveError && <div className="banner-error mt-4">{approveError}</div>}

          <Card className="mt-6 space-y-5 p-6">
            <ViewField label="Created by" value={entry.createdByName} placeholder="Not recorded" />
            {entry.status === "approved" && (
              <ViewField
                label="Approved by"
                value={
                  entry.approvedByName
                    ? `${entry.approvedByName}${entry.approvedAt ? ` on ${new Date(entry.approvedAt).toLocaleDateString()}` : ""}`
                    : null
                }
                placeholder="Not recorded"
              />
            )}
            {customFields.length === 0 ? (
              <p className="text-sm text-slate-500">No additional fields configured for this form.</p>
            ) : (
              customFields.map((field) => {
                const value = customFieldValues[field.fieldKey];
                const display = Array.isArray(value) ? value.join(", ") : (value as string | number | undefined);
                return <ViewField key={field.id} label={field.label} value={display} placeholder="Not set" />;
              })
            )}
          </Card>
        </>
      )}
    </main>
  );
}
