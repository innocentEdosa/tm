"use client";

import { Button } from "@tm/ui";
import type { AiToolExecution } from "@/lib/ai-api-client";

interface ProposalDetail {
  title: string;
  subtitle: string;
  rows: { label: string; value: string }[];
  actionLabel: string;
  reversibilityNote: string;
}

/** Turns a raw tool execution's `toolName`/`input` into the human-readable proposal shape the
 * card renders — the frontend counterpart of `ai/routes.ts`'s `humanizeToolName`. One case per
 * Forms tool (the only mutating tools that exist yet); a new domain's mutating tools add a case
 * here, not a generic fallback that hides what's actually about to happen. */
function describeProposal(execution: AiToolExecution): ProposalDetail {
  const input = execution.input as Record<string, unknown>;
  const formKey = typeof input.formKey === "string" ? input.formKey : "this form";

  if (execution.toolName === "create_form_field") {
    const options = Array.isArray(input.options) ? (input.options as string[]) : undefined;
    return {
      title: "Add field to form",
      subtitle: `Form: ${formKey}`,
      rows: [
        { label: "Field", value: String(input.label ?? "") },
        { label: "Type", value: String(input.fieldType ?? "") },
        { label: "Required", value: input.isRequired ? "Yes" : "No" },
        ...(options ? [{ label: "Options", value: options.join(", ") }] : []),
      ],
      actionLabel: "Create field",
      reversibilityNote: "You can edit or archive this field later — nothing about this is permanent.",
    };
  }

  if (execution.toolName === "update_form_field") {
    const archived = input.archived === true;
    const rows: { label: string; value: string }[] = [];
    if (input.label !== undefined) rows.push({ label: "New label", value: String(input.label) });
    if (input.fieldType !== undefined) rows.push({ label: "New type", value: String(input.fieldType) });
    if (input.isRequired !== undefined) rows.push({ label: "Required", value: input.isRequired ? "Yes" : "No" });
    if (archived) rows.push({ label: "Action", value: "Archive this field" });
    return {
      title: archived ? "Archive field" : "Update field",
      subtitle: `Form: ${formKey}`,
      rows: rows.length > 0 ? rows : [{ label: "Change", value: "No visible field changes detected" }],
      actionLabel: archived ? "Archive field" : "Update field",
      reversibilityNote: archived
        ? "Archiving hides this field from the form — it is not permanently deleted and can be restored by an admin."
        : "You can change this again later.",
    };
  }

  if (execution.toolName === "reorder_form_fields") {
    const fieldIds = Array.isArray(input.fieldIds) ? (input.fieldIds as string[]) : [];
    return {
      title: "Reorder fields",
      subtitle: `Form: ${formKey}`,
      rows: [{ label: "New order", value: `${fieldIds.length} field${fieldIds.length === 1 ? "" : "s"} repositioned` }],
      actionLabel: "Reorder fields",
      reversibilityNote: "You can reorder fields again at any time.",
    };
  }

  return {
    title: execution.toolName.replace(/_/g, " "),
    subtitle: "",
    rows: Object.entries(input).map(([label, value]) => ({ label, value: String(value) })),
    actionLabel: "Confirm",
    reversibilityNote: "",
  };
}

export interface ProposalCardProps {
  execution: AiToolExecution;
  onConfirm: (executionId: string) => void;
  onReject: (executionId: string) => void;
  busy?: boolean;
}

/**
 * The most important UI in the AI Foundation's Phase 2 — renders a `pending_confirmation`
 * tool execution as an explicit, reviewable proposal, never letting a mutation's detail hide
 * behind the chat bubble's own text. Also renders a resolved (executed/rejected/failed/expired)
 * execution as a compact status line, so history/recovery views can reuse this one component.
 */
export function ProposalCard({ execution, onConfirm, onReject, busy }: ProposalCardProps) {
  const detail = describeProposal(execution);

  if (execution.status !== "pending_confirmation") {
    const statusLabel: Record<string, string> = {
      executed: "Done",
      rejected: "Cancelled",
      failed: "Failed",
      expired: "Expired — ask again",
    };
    const statusClass: Record<string, string> = {
      executed: "bg-green-50 text-green-700 border-green-200",
      rejected: "bg-slate-50 text-slate-600 border-slate-200",
      failed: "bg-red-50 text-red-700 border-red-200",
      expired: "bg-amber-50 text-amber-700 border-amber-200",
    };
    return (
      <div className="mt-2 rounded-lg border border-border bg-white px-3 py-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-primary">{detail.title}</span>
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusClass[execution.status] ?? ""}`}>
            {statusLabel[execution.status] ?? execution.status}
          </span>
        </div>
        {execution.status === "failed" && execution.error && <p className="mt-1 text-xs text-red-600">{execution.error}</p>}
      </div>
    );
  }

  return (
    <div className="surface-card mt-2 !p-4">
      <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Proposed change</p>
      <h3 className="mt-1 font-heading text-base font-bold text-primary">{detail.title}</h3>
      {detail.subtitle && <p className="text-sm text-slate-500">{detail.subtitle}</p>}
      <dl className="mt-3 space-y-1.5">
        {detail.rows.map((row) => (
          <div key={row.label} className="flex gap-2 text-sm">
            <dt className="w-28 shrink-0 font-medium text-slate-500">{row.label}</dt>
            <dd className="text-primary">{row.value}</dd>
          </div>
        ))}
      </dl>
      {detail.reversibilityNote && <p className="mt-3 text-xs text-slate-500">{detail.reversibilityNote}</p>}
      <div className="mt-4 flex gap-2">
        <Button variant="primary" size="sm" onClick={() => onConfirm(execution.id)} disabled={busy}>
          Confirm — {detail.actionLabel}
        </Button>
        <Button variant="outline" size="sm" onClick={() => onReject(execution.id)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
