/**
 * The provider-agnostic contract every AI adapter implements — the AI-layer counterpart of
 * `mail/mail-sender.ts`'s `MailSender` (Email API Mailer spec precedent). A future model/provider
 * swap means adding one new implementation of `AiProvider` and changing which one `invoke-ai.ts`
 * wires in, never touching a call site (`ai/tools/*`, `ai/routes.ts`).
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  /** For `role: "tool"`, this is the tool's JSON-stringified result. */
  content: string;
  /** Only set on a `role: "tool"` message — which prior tool call this result answers. */
  toolCallId?: string;
}

/** JSON-Schema-shaped, not a Zod type — this is what actually crosses the wire to a model
 * provider's tool-calling API. `ai/tool-registry.ts` tools carry Zod schemas for our own input
 * validation; converting one to the other is `ai/provider/zod-to-json-schema.ts`'s job, not this
 * interface's. */
export interface ChatToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ChatInput {
  messages: ChatMessage[];
  tools?: ChatToolSpec[];
  maxTokens?: number;
}

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ChatStopReason = "end_turn" | "tool_use" | "max_tokens" | "error";

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResult {
  /** The assistant's plain-text reply, if any — a tool-only turn (`stopReason: "tool_use"` with no
   * accompanying text) may leave this `null`. */
  content: string | null;
  toolCalls: ChatToolCall[];
  stopReason: ChatStopReason;
  usage: ChatUsage;
}

export type ChatChunk =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; toolCall: ChatToolCall }
  | { type: "done"; stopReason: ChatStopReason; usage: ChatUsage };

export interface AiProvider {
  /** MUST return `false` whenever any credential this provider needs is missing/empty, and MUST
   * NOT perform a network call to determine this — same contract as `MailSender.isConfigured()`. */
  isConfigured(): boolean;
  /** One request/response round trip, tool-calling included. MAY throw/reject for any provider
   * failure — the caller (`invoke-ai.ts`) owns catching it, not this method. */
  chat(input: ChatInput): Promise<ChatResult>;
  /** Same request, streamed. Still MAY throw/reject before or during iteration. */
  streamChat(input: ChatInput): AsyncIterable<ChatChunk>;
}
