import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionMessageToolCall } from "openai/resources/chat/completions";
import type { AiProvider, ChatChunk, ChatInput, ChatMessage, ChatResult, ChatStopReason } from "./ai-provider";

const DEFAULT_MODEL = "gpt-4.1";
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Converts our provider-agnostic history to OpenAI's shape. The one wrinkle: OpenAI's API rejects
 * a `role: "tool"` message unless the immediately preceding assistant message carries a matching
 * entry in `tool_calls` (by id) — unlike Anthropic, which used to be satisfied by plain text alone.
 * `ChatMessage.toolCalls` (AI Foundation — Structured Tool Context) is the real, trusted call an
 * assistant message made — sourced from an actual tool execution, whether this is a same-turn
 * in-memory follow-up (`ai/routes.ts`'s read-tool round trip) or reconstructed from persisted
 * history — so it's translated directly into OpenAI's `tool_calls` here, real name and arguments
 * included, no placeholder synthesis needed anymore.
 */
function toOpenAiMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
  const converted: ChatCompletionMessageParam[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      converted.push({ role: "system", content: m.content });
    } else if (m.role === "user") {
      converted.push({ role: "user", content: m.content });
    } else if (m.role === "tool") {
      converted.push({ role: "tool", tool_call_id: m.toolCallId!, content: m.content });
    } else if (m.toolCalls && m.toolCalls.length > 0) {
      converted.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } })),
      });
    } else {
      converted.push({ role: "assistant", content: m.content });
    }
  }

  return converted;
}

function mapStopReason(reason: string | null | undefined): ChatStopReason {
  if (reason === "tool_calls") return "tool_use";
  if (reason === "length") return "max_tokens";
  if (reason === "stop") return "end_turn";
  return "error";
}

function toChatToolCalls(calls: ChatCompletionMessageToolCall[] | undefined): ChatResult["toolCalls"] {
  if (!calls) return [];
  return calls
    .filter((c) => c.type === "function")
    .map((c) => ({
      id: c.id,
      name: c.function.name,
      arguments: c.function.arguments ? JSON.parse(c.function.arguments) : {},
    }));
}

/**
 * Second `AiProvider` implementation, selected via `AI_PROVIDER=openai` (`invoke-ai.ts`). Uses the
 * Chat Completions API — not the Responses API — since it maps directly onto `ChatMessage`/tool
 * calling/streaming the same way `anthropic-provider.ts`'s Messages API does. Model id is
 * env-configurable via the same `AI_PROVIDER_MODEL` var Anthropic uses (only one provider is ever
 * active at a time, so there's no need for provider-prefixed model env vars).
 */
export class OpenAiProvider implements AiProvider {
  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({ apiKey: process.env.AI_PROVIDER_API_KEY });
    }
    return this.client;
  }

  isConfigured(): boolean {
    return Boolean(process.env.AI_PROVIDER_API_KEY);
  }

  async chat(input: ChatInput): Promise<ChatResult> {
    const response = await this.getClient().chat.completions.create({
      model: process.env.AI_PROVIDER_MODEL || DEFAULT_MODEL,
      max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: toOpenAiMessages(input.messages),
      tools: input.tools?.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      })),
    });

    const choice = response.choices[0];
    const message = choice?.message;

    return {
      content: message?.content ?? null,
      toolCalls: toChatToolCalls(message?.tool_calls),
      stopReason: mapStopReason(choice?.finish_reason),
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }

  async *streamChat(input: ChatInput): AsyncIterable<ChatChunk> {
    const stream = await this.getClient().chat.completions.create({
      model: process.env.AI_PROVIDER_MODEL || DEFAULT_MODEL,
      max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: toOpenAiMessages(input.messages),
      tools: input.tools?.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      })),
      stream: true,
      stream_options: { include_usage: true },
    });

    // Unlike Anthropic's content_block_stop, Chat Completions streams tool-call args as
    // index-keyed deltas with no explicit "this one's done" event — a call is only known-complete
    // once the stream ends, so buffer by index and flush after the loop.
    const pending = new Map<number, { id: string; name: string; argsBuffer: string }>();
    let finishReason: string | null | undefined;
    let usage = { inputTokens: 0, outputTokens: 0 };

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      const delta = choice?.delta;

      if (delta?.content) {
        yield { type: "text_delta", text: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const entry = pending.get(tc.index) ?? { id: "", name: "", argsBuffer: "" };
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name = tc.function.name;
          if (tc.function?.arguments) entry.argsBuffer += tc.function.arguments;
          pending.set(tc.index, entry);
        }
      }

      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (chunk.usage) {
        usage = { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens };
      }
    }

    for (const call of pending.values()) {
      yield {
        type: "tool_call",
        toolCall: { id: call.id, name: call.name, arguments: call.argsBuffer ? JSON.parse(call.argsBuffer) : {} },
      };
    }

    yield { type: "done", stopReason: mapStopReason(finishReason), usage };
  }
}
