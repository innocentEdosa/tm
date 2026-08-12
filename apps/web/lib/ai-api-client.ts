const AI_API_BASE = "/tenant-api/ai";

interface AiFetchOptions {
  method?: "GET" | "POST";
  body?: unknown;
  subdomain: string;
}

/**
 * Thin fetch wrapper for the AI Foundation's routes, matching `tenantFetch`'s shape
 * (`lib/tenant-api-client.ts`) exactly — same `credentials: "include"` + `subdomain` query param
 * convention — but rooted at `/tenant-api/ai` rather than `/tenant-api/tenant`, since
 * `apps/api/src/ai/routes.ts` registers its routes at `/ai/*`, not `/tenant/ai/*` (there is no
 * `/tenant` prefix on any AI route — see `apps/api/src/server.ts`).
 */
export async function aiFetch<T>(path: string, { method = "GET", body, subdomain }: AiFetchOptions): Promise<T> {
  const separator = path.includes("?") ? "&" : "?";
  const url = `${AI_API_BASE}${path}${separator}subdomain=${encodeURIComponent(subdomain)}`;
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((json as { message?: string } | null)?.message ?? `AI request to ${path} failed (${res.status})`);
  }
  return json as T;
}

export type AiMessageRole = "user" | "assistant" | "tool";

export type AiToolExecutionStatus = "pending_confirmation" | "executed" | "rejected" | "failed" | "expired";

export interface AiToolExecution {
  id: string;
  conversationId: string;
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
  status: AiToolExecutionStatus;
  mutating: boolean;
  error: string | null;
  createdAt: string;
  confirmedAt: string | null;
  expiresAt: string | null;
}

export interface AiMessage {
  id: string;
  conversationId: string;
  role: AiMessageRole;
  content: string;
  toolExecutionId: string | null;
  toolExecution: AiToolExecution | null;
  createdAt: string;
}

export interface AiConversationSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export function createConversation(subdomain: string): Promise<{ success: true; data: AiConversationSummary }> {
  return aiFetch("/conversations", { method: "POST", subdomain, body: {} });
}

export function listConversations(subdomain: string): Promise<{ success: true; data: AiConversationSummary[] }> {
  return aiFetch("/conversations", { subdomain });
}

export function getConversation(
  conversationId: string,
  subdomain: string,
): Promise<{ success: true; data: { conversation: { id: string; createdAt: string }; messages: AiMessage[] } }> {
  return aiFetch(`/conversations/${conversationId}`, { subdomain });
}

export function sendMessage(
  conversationId: string,
  content: string,
  subdomain: string,
  context?: { formKey?: string; courseId?: string },
): Promise<{ success: true; data: { message: AiMessage; toolExecution: AiToolExecution | null } }> {
  return aiFetch(`/conversations/${conversationId}/messages`, { method: "POST", subdomain, body: { content, context } });
}

export function confirmToolExecution(executionId: string, subdomain: string): Promise<{ success: true; data: AiToolExecution }> {
  return aiFetch(`/tool-executions/${executionId}/confirm`, { method: "POST", subdomain, body: {} });
}

export function rejectToolExecution(executionId: string, subdomain: string): Promise<{ success: true; data: AiToolExecution }> {
  return aiFetch(`/tool-executions/${executionId}/reject`, { method: "POST", subdomain, body: {} });
}

export function listToolExecutions(subdomain: string, status?: AiToolExecutionStatus): Promise<{ success: true; data: AiToolExecution[] }> {
  return aiFetch(`/tool-executions${status ? `?status=${status}` : ""}`, { subdomain });
}
