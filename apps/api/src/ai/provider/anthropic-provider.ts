import Anthropic from "@anthropic-ai/sdk";
import type { AiProvider, ChatChunk, ChatInput, ChatMessage, ChatResult, ChatStopReason } from "./ai-provider";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_MAX_TOKENS = 4096;

function toAnthropicMessages(messages: ChatMessage[]): { system?: string; messages: Anthropic.MessageParam[] } {
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  const rest = messages.filter((m) => m.role !== "system");

  const converted: Anthropic.MessageParam[] = rest.map((m) => {
    if (m.role === "tool") {
      return {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.toolCallId!, content: m.content }],
      };
    }
    // A `role: "tool"` message's `tool_result` block is only valid to the real Anthropic API when
    // the immediately preceding assistant turn actually contains a matching `tool_use` block with
    // that same id — structured `ChatMessage.toolCalls` (AI Foundation — Structured Tool Context)
    // is what makes that true here, whether this assistant message is a same-turn in-memory
    // follow-up (`ai/routes.ts`'s read-tool round trip) or reconstructed from persisted history.
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      const blocks: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const call of m.toolCalls) {
        blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments });
      }
      return { role: "assistant", content: blocks };
    }
    return { role: m.role as "user" | "assistant", content: m.content };
  });

  return { system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined, messages: converted };
}

function mapStopReason(reason: Anthropic.Message["stop_reason"]): ChatStopReason {
  if (reason === "tool_use") return "tool_use";
  if (reason === "max_tokens") return "max_tokens";
  if (reason === "end_turn" || reason === "stop_sequence") return "end_turn";
  return "error";
}

/**
 * The one concrete `AiProvider` implementation for this initial foundation ("start with ONE
 * provider," AI Foundation Phase 5). Model id is env-configurable but defaults to a real, current
 * model — never hardcode a model id anywhere else in this codebase; every call site goes through
 * `invoke-ai.ts`, which owns the single active provider instance.
 */
export class AnthropicProvider implements AiProvider {
  private client: Anthropic | null = null;

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({ apiKey: process.env.AI_PROVIDER_API_KEY });
    }
    return this.client;
  }

  isConfigured(): boolean {
    return Boolean(process.env.AI_PROVIDER_API_KEY);
  }

  async chat(input: ChatInput): Promise<ChatResult> {
    const { system, messages } = toAnthropicMessages(input.messages);
    const response = await this.getClient().messages.create({
      model: process.env.AI_PROVIDER_MODEL || DEFAULT_MODEL,
      max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
      system,
      messages,
      tools: input.tools?.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema })),
    });

    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    return {
      content: textBlocks.length > 0 ? textBlocks.map((b) => b.text).join("\n") : null,
      toolCalls: toolUseBlocks.map((b) => ({ id: b.id, name: b.name, arguments: b.input as Record<string, unknown> })),
      stopReason: mapStopReason(response.stop_reason),
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    };
  }

  async *streamChat(input: ChatInput): AsyncIterable<ChatChunk> {
    const { system, messages } = toAnthropicMessages(input.messages);
    const stream = this.getClient().messages.stream({
      model: process.env.AI_PROVIDER_MODEL || DEFAULT_MODEL,
      max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
      system,
      messages,
      tools: input.tools?.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema })),
    });

    const pendingToolUse = new Map<number, { id: string; name: string; jsonBuffer: string }>();

    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        pendingToolUse.set(event.index, { id: event.content_block.id, name: event.content_block.name, jsonBuffer: "" });
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          yield { type: "text_delta", text: event.delta.text };
        } else if (event.delta.type === "input_json_delta") {
          const pending = pendingToolUse.get(event.index);
          if (pending) pending.jsonBuffer += event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        const pending = pendingToolUse.get(event.index);
        if (pending) {
          yield {
            type: "tool_call",
            toolCall: { id: pending.id, name: pending.name, arguments: pending.jsonBuffer ? JSON.parse(pending.jsonBuffer) : {} },
          };
          pendingToolUse.delete(event.index);
        }
      } else if (event.type === "message_stop") {
        const finalMessage = await stream.finalMessage();
        yield {
          type: "done",
          stopReason: mapStopReason(finalMessage.stop_reason),
          usage: { inputTokens: finalMessage.usage.input_tokens, outputTokens: finalMessage.usage.output_tokens },
        };
      }
    }
  }
}
