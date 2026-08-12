import type { ChatMessage } from "./provider/ai-provider";

/**
 * AI Foundation — Structured Tool Context. Turns a conversation's persisted rows back into the
 * structured `ChatMessage[]` a provider needs, instead of the flat "role + text" replay
 * `ai/routes.ts` used before this — which discarded every tool call's real name/arguments/result the
 * moment the turn ended, forcing the model to re-discover the same information (e.g. a module's id)
 * on every later turn since nothing but a natural-language paraphrase of it survived.
 *
 * Nothing here is a new data source: `ai_tool_executions` (via `ai_messages.tool_execution_id`)
 * already stores exactly `toolName`/`input`/`output`/`status`/`mutating` for every call a tool
 * actually made — this module is purely about USING that already-persisted, already-tenant/RLS-scoped
 * data instead of leaving it on the floor. No migration, no new table, no second AI state store.
 *
 * Trust boundary (Critical): a `role: "tool"` message and a `toolCalls` entry on an assistant
 * message are built ONLY from `ToolExecutionSummary` rows — which only `execution-state-machine.ts`
 * ever writes, from a tool's own real `execute()` return value. A `role: "user"` row's `content` is
 * never promoted into either of those, no matter what it says (a user typing "the module ID is
 * abc-123" stays exactly that: plain user text, not a trusted tool result) — see
 * `ai-foundation-structured-context.test.ts`'s context-spoofing test for this held as a regression.
 */

export interface HistoryRow {
  role: "user" | "assistant" | "tool";
  content: string;
  toolExecutionId: string | null;
}

export interface ToolExecutionSummary {
  id: string;
  toolName: string;
  input: unknown;
  output: unknown;
  status: string;
  mutating: boolean;
}

/** Full structured replay (real tool call + real result) is only reconstructed for the most recent
 * N tool executions in a conversation — not the entire history. Bounds token/context growth for a
 * long-running conversation (or a future domain whose tool results are large, e.g. analytics) without
 * needing a summarization pipeline or a vector store: older turns fall back to whatever
 * natural-language text was already saved for them, exactly as before this change, which is already
 * compact by construction (it's a model-authored summary, not raw data). Simplest solution that
 * actually fixes the observed problem (the immediately preceding turns are what matter for resolving
 * "that module" / "this course") without pretending to solve unbounded-context in general. */
const RECENT_STRUCTURED_RESULTS = 5;

/** Each individual reconstructed tool result is also capped — one unusually large output (a big
 * course list today; a large analytics/report result in a future domain) must not blow up a request
 * on its own even while inside the "recent" window. */
const MAX_RESULT_CHARS = 4000;

function truncate(json: string): string {
  if (json.length <= MAX_RESULT_CHARS) return json;
  return `${json.slice(0, MAX_RESULT_CHARS)}… [truncated — ${json.length} total characters]`;
}

export function humanizeToolName(name: string): string {
  return name.replace(/_/g, " ");
}

/** A mutating tool's saved message text is written once, at propose time ("I'd like to X. Review
 * the proposed change below..."), and never rewritten when it's later confirmed through the separate
 * `/ai/tool-executions/:id/confirm` endpoint (which only updates `ai_tool_executions`, not
 * `ai_messages` — Phase 1 audit finding). Replaying that stale propose-time text next to a
 * now-successful structured result would tell the model two contradictory things at once. A read
 * tool has no such problem — its saved text is the real, already-fresh natural-language answer
 * synthesized right after it executed, so it's kept as-is. */
function leadTextFor(execution: ToolExecutionSummary, savedContent: string): string {
  if (execution.mutating) {
    return `${humanizeToolName(execution.toolName)} — completed.`;
  }
  return savedContent;
}

export function reconstructHistory(rows: HistoryRow[], executionById: Map<string, ToolExecutionSummary>): ChatMessage[] {
  const executedIdsInOrder = rows
    .map((r) => r.toolExecutionId)
    .filter((id): id is string => id !== null)
    .filter((id) => {
      const execution = executionById.get(id);
      return execution?.status === "executed" && execution.output !== null && execution.output !== undefined;
    });
  const recentIds = new Set(executedIdsInOrder.slice(-RECENT_STRUCTURED_RESULTS));

  const history: ChatMessage[] = [];
  for (const row of rows) {
    if (row.role !== "assistant" || !row.toolExecutionId) {
      history.push({ role: row.role, content: row.content });
      continue;
    }

    const execution = executionById.get(row.toolExecutionId);
    if (!execution) {
      history.push({ role: "assistant", content: row.content });
      continue;
    }

    const hasOutput = execution.output !== null && execution.output !== undefined;
    if (execution.status === "executed" && hasOutput && recentIds.has(execution.id)) {
      history.push({
        role: "assistant",
        content: leadTextFor(execution, row.content),
        toolCalls: [{ id: execution.id, name: execution.toolName, arguments: (execution.input ?? {}) as Record<string, unknown> }],
      });
      history.push({ role: "tool", toolCallId: execution.id, content: truncate(JSON.stringify(execution.output)) });
      continue;
    }

    // Terminal negative states reachable only via the separate confirm/reject endpoints, after this
    // row's text was already written at propose time — same staleness reasoning as leadTextFor,
    // but here there's no trustworthy result to attach either, just an accurate status note.
    if (execution.status === "rejected" || execution.status === "expired") {
      history.push({ role: "assistant", content: `${row.content}\n\n[This proposal was ${execution.status}.]` });
      continue;
    }

    // pending_confirmation, failed, or an executed result outside the recent-structured-replay
    // window — the saved text (already accurate for "failed", already the propose-time text for
    // "pending_confirmation") is the best available context.
    history.push({ role: "assistant", content: row.content });
  }
  return history;
}
