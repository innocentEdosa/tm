import type { AiProvider, ChatChunk, ChatInput, ChatResult } from "../../src/ai/provider/ai-provider";

/** Shared by `ai-foundation-structured-context.test.ts` and `ai-foundation-tool-selection.test.ts` —
 * both need to assert on the exact `ChatInput.messages` the app built for a given turn, which a live
 * provider call can't expose and which mocking at a lower level wouldn't prove (the point in both
 * files is that the real HTTP route → real Postgres → real reconstructed history round trip works,
 * not just that some function returns the right shape in isolation). */

export function usage() {
  return { inputTokens: 0, outputTokens: 0 };
}

/** Replays a fixed sequence of responses, one per `chat()` call, and records the exact `ChatInput`
 * each call received so a test can assert on precisely what the app sent. */
export class ScriptedProvider implements AiProvider {
  public receivedInputs: ChatInput[] = [];
  private callIndex = 0;
  constructor(private readonly script: ((input: ChatInput, callIndex: number) => ChatResult)[]) {}

  isConfigured(): boolean {
    return true;
  }

  async chat(input: ChatInput): Promise<ChatResult> {
    this.receivedInputs.push(input);
    const fn = this.script[this.callIndex];
    if (!fn) throw new Error(`ScriptedProvider: no scripted response for call #${this.callIndex}`);
    const result = fn(input, this.callIndex);
    this.callIndex++;
    return result;
  }

  /** Throws before ever reaching a yield; still an async generator so its return type matches
   * `AiProvider.streamChat`'s `AsyncIterable<ChatChunk>` exactly. */
  // eslint-disable-next-line require-yield
  async *streamChat(): AsyncIterable<ChatChunk> {
    throw new Error("ScriptedProvider.streamChat not implemented — not exercised by these tests");
  }
}

/** Always-unconfigured stand-in, restored after every test that installs a `ScriptedProvider` so it
 * never leaks into another file's "503 when unconfigured" expectations — vitest runs integration
 * test files sequentially in one process (`fileParallelism: false`), sharing `invoke-ai.ts`'s
 * module-level `activeProvider` singleton. */
export class NotConfiguredProvider implements AiProvider {
  isConfigured(): boolean {
    return false;
  }
  async chat(): Promise<ChatResult> {
    throw new Error("not configured");
  }
  // eslint-disable-next-line require-yield -- see ScriptedProvider.streamChat's note above.
  async *streamChat(): AsyncIterable<ChatChunk> {
    throw new Error("not configured");
  }
}
