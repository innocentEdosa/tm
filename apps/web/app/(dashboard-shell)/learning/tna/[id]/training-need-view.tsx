"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader, Card, Badge, Button } from "@tm/ui";

const API_BASE = "/tenant-api/tenant";

type Priority = "low" | "medium" | "high";
type Status = "draft" | "submitted";
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
  status: Status;
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
 * Read-only detail page at `/learning/tna/[id]` — a dedicated page, not a Drawer (per direct
 * product feedback, matching the create/edit form's own move off Drawer). The entry's own title,
 * status, and priority surface as the page header; every tenant custom field renders below, in
 * `display_order`, exactly as configured in Settings > Forms.
 */
export default function TrainingNeedView({
  subdomain,
  trainingNeedId,
  canManage,
}: {
  subdomain: string;
  trainingNeedId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState<TrainingNeedDetail | null>(null);
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    fetch(`${API_BASE}/training-needs/${trainingNeedId}?subdomain=${encodeURIComponent(subdomain)}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { data: TrainingNeedDetail } | null) => {
        if (!json) {
          setError("This training need couldn't be found.");
          return;
        }
        setEntry(json.data);
      })
      .catch(() => setError("Couldn't load this training need. Try again."))
      .finally(() => setLoading(false));

    fetch(
      `${API_BASE}/form-fields?formKey=training_needs_analysis&subdomain=${encodeURIComponent(subdomain)}`,
      { credentials: "include" },
    )
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((json: { data: CustomFieldDefinition[] }) => setCustomFields(json.data.filter((f) => !f.isSystem)))
      .catch(() => setCustomFields([]));

    fetch(
      `${API_BASE}/custom-field-values?formKey=training_needs_analysis&entityId=${trainingNeedId}&subdomain=${encodeURIComponent(subdomain)}`,
      { credentials: "include" },
    )
      .then((res) => (res.ok ? res.json() : { data: {} }))
      .then((json: { data: Record<string, unknown> }) => setCustomFieldValues(json.data))
      .catch(() => setCustomFieldValues({}));
  }, [trainingNeedId, subdomain]);

  return (
    <main className="mx-auto max-w-3xl px-8 py-8">
      <button
        type="button"
        className="mb-4 flex cursor-pointer items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary"
        onClick={() => router.push("/learning/tna")}
      >
        <ArrowLeft className="h-4 w-4" />
        Training Needs Analysis
      </button>

      {loading ? (
        <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
      ) : error || !entry ? (
        <div className="banner-error">{error ?? "This training need couldn't be found."}</div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <PageHeader title={entry.title} subtitle={entry.departmentName ?? undefined} />
              <Badge variant={entry.status === "submitted" ? "success" : "neutral"}>
                {entry.status === "submitted" ? "Submitted" : "Draft"}
              </Badge>
              <Badge variant={PRIORITY_BADGE[entry.priority]}>{PRIORITY_LABEL[entry.priority]} priority</Badge>
            </div>
            {canManage && (
              <Button onClick={() => router.push(`/learning/tna/${trainingNeedId}/edit`)}>Edit</Button>
            )}
          </div>

          <Card className="mt-6 space-y-5 p-6">
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
