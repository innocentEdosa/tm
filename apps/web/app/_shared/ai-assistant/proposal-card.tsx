"use client";

import { Button } from "@tm/ui";
import type { AiToolExecution } from "@/lib/ai-api-client";
import { describeProposal } from "./proposal-description";

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
      {detail.imagePreview && (
        <div className="mt-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- external provider URL (Unsplash CDN), same plain-<img> precedent as courseImageUrl elsewhere in this app */}
          <img src={detail.imagePreview.imageUrl} alt={detail.imagePreview.title ?? "Selected image"} className="max-h-48 w-full rounded-lg object-cover" />
          <p className="mt-1 text-xs text-slate-500">
            {detail.imagePreview.author ? (
              <>
                Photo by{" "}
                {detail.imagePreview.authorUrl ? (
                  <a href={detail.imagePreview.authorUrl} target="_blank" rel="noreferrer" className="underline">
                    {detail.imagePreview.author}
                  </a>
                ) : (
                  detail.imagePreview.author
                )}{" "}
                on{" "}
              </>
            ) : (
              "Via "
            )}
            {detail.imagePreview.sourceUrl ? (
              <a href={detail.imagePreview.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                Unsplash
              </a>
            ) : (
              "Unsplash"
            )}
            {detail.imagePreview.license && (
              <>
                {" "}
                ·{" "}
                {detail.imagePreview.licenseUrl ? (
                  <a href={detail.imagePreview.licenseUrl} target="_blank" rel="noreferrer" className="underline">
                    {detail.imagePreview.license}
                  </a>
                ) : (
                  detail.imagePreview.license
                )}
              </>
            )}
          </p>
        </div>
      )}
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
