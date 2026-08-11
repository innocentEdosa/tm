"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, Toast, type ToastVariant } from "@tm/ui";
import { listToolExecutions, confirmToolExecution, rejectToolExecution, type AiToolExecution } from "@/lib/ai-api-client";
import { ProposalCard } from "@/app/_shared/ai-assistant/proposal-card";

const STATUS_LABEL: Record<string, string> = {
  pending_confirmation: "Pending confirmation",
  executed: "Completed",
  rejected: "Cancelled",
  failed: "Failed",
  expired: "Expired",
};

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Tenant AI Activity — this user's own AI conversations' tool actions (Pending Confirmation
 * Recovery + AI Activity/History, AI Foundation Phase 2). Scoped to the current user, not
 * tenant-wide (see `docs/ai-foundation-architecture.md`'s scope note: no tenant-wide admin
 * oversight view exists yet, since that would need a new permission key this phase didn't
 * introduce). Reusing `ProposalCard` here means a pending action looks and behaves identically
 * whether the admin confirms it from the chat drawer at the moment it was proposed, or comes back
 * to it later from this page after closing the drawer entirely.
 */
export default function AiActivityClient({ subdomain }: { subdomain: string }) {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["ai-tool-executions", subdomain],
    queryFn: () => listToolExecutions(subdomain),
  });

  const executions = data?.data ?? [];
  const pending = executions.filter((e) => e.status === "pending_confirmation");
  const history = executions.filter((e) => e.status !== "pending_confirmation");

  async function handleConfirm(executionId: string) {
    setBusyId(executionId);
    try {
      const res = await confirmToolExecution(executionId, subdomain);
      setToast({ message: res.data.status === "executed" ? "Change confirmed and applied." : `Confirmation failed: ${res.data.error}`, variant: res.data.status === "executed" ? "success" : "error" });
      await queryClient.invalidateQueries({ queryKey: ["ai-tool-executions", subdomain] });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Couldn't confirm this action.", variant: "error" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(executionId: string) {
    setBusyId(executionId);
    try {
      await rejectToolExecution(executionId, subdomain);
      setToast({ message: "Change cancelled — nothing was modified.", variant: "success" });
      await queryClient.invalidateQueries({ queryKey: ["ai-tool-executions", subdomain] });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Couldn't cancel this action.", variant: "error" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader title="AI Activity" subtitle="Conversations and changes the AI assistant has proposed or made on your behalf." />

      {isLoading && <p className="mt-6 text-sm text-slate-400">Loading…</p>}
      {error && <p className="banner-error mt-6">{error instanceof Error ? error.message : "Couldn't load AI activity."}</p>}

      {!isLoading && !error && executions.length === 0 && (
        <div className="surface-card mt-6 text-center">
          <p className="text-sm text-slate-500">You haven&apos;t used the AI assistant yet. Open it from the sparkle button to get started.</p>
        </div>
      )}

      {pending.length > 0 && (
        <section className="mt-6">
          <h2 className="font-heading text-sm font-bold tracking-wide text-primary uppercase">Awaiting your confirmation</h2>
          <div className="mt-3 space-y-3">
            {pending.map((execution) => (
              <ActivityRow key={execution.id} execution={execution} onConfirm={handleConfirm} onReject={handleReject} busy={busyId === execution.id} />
            ))}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section className="mt-8">
          <h2 className="font-heading text-sm font-bold tracking-wide text-primary uppercase">History</h2>
          <div className="mt-3 space-y-3">
            {history.map((execution) => (
              <ActivityRow key={execution.id} execution={execution} onConfirm={handleConfirm} onReject={handleReject} busy={busyId === execution.id} />
            ))}
          </div>
        </section>
      )}

      {toast && <Toast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />}
    </div>
  );
}

function ActivityRow({
  execution,
  onConfirm,
  onReject,
  busy,
}: {
  execution: AiToolExecution;
  onConfirm: (id: string) => void;
  onReject: (id: string) => void;
  busy: boolean;
}) {
  return (
    <div className="surface-card !p-4">
      <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
        <span>
          {execution.mutating ? "Change" : "Question"} · {formatTimestamp(execution.createdAt)}
        </span>
        <span>{STATUS_LABEL[execution.status] ?? execution.status}</span>
      </div>
      <ProposalCard execution={execution} onConfirm={onConfirm} onReject={onReject} busy={busy} />
    </div>
  );
}
