import type { AiProvider, ChatInput, ChatResult } from "./ai-provider";
import { AnthropicProvider } from "./anthropic-provider";
import { OpenAiProvider } from "./openai-provider";

const CHAT_TIMEOUT_MS = 30000;

/** `AI_PROVIDER` picks which `AiProvider` implementation is active — "anthropic" (default, for
 * unset/unrecognized values) or "openai". Both read credentials/model from the same
 * `AI_PROVIDER_API_KEY`/`AI_PROVIDER_MODEL` vars since only one provider is ever active at a time;
 * see apps/api/.env.example. */
function createProvider(): AiProvider {
  return process.env.AI_PROVIDER === "openai" ? new OpenAiProvider() : new AnthropicProvider();
}

let activeProvider: AiProvider = createProvider();

/** Test-only seam, same shape as `mail/send-mail.ts`'s `__setMailSenderForTesting` — lets tests
 * install a fake `AiProvider` to prove the wrapper guarantees below hold independent of which
 * provider is active, without making a real network call in the test suite. */
export function __setAiProviderForTesting(provider: AiProvider): void {
  activeProvider = provider;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI is not configured — set AI_PROVIDER_API_KEY.");
    this.name = "AiNotConfiguredError";
  }
}

export class AiProviderError extends Error {
  constructor(cause: unknown) {
    super(`AI provider request failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "AiProviderError";
  }
}

export class AiTimeoutError extends Error {
  constructor(ms: number) {
    super(`AI provider request timed out after ${ms}ms`);
    this.name = "AiTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AiTimeoutError(ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * The single place bounded-timeout and provider-error-wrapping guarantees live for a non-streaming
 * chat call — enforced once, around whichever `AiProvider` is active, mirroring
 * `mail/send-mail.ts`'s `sendMail()`. Unlike email, an AI request is synchronously awaited by the
 * user asking a question — there is no safe "skip and move on" here, so an unconfigured provider
 * throws `AiNotConfiguredError` rather than silently no-op-ing; the caller (`ai/routes.ts`) is
 * responsible for turning that into a clear user-facing error, not a fake empty response.
 */
export async function invokeAi(input: ChatInput): Promise<ChatResult> {
  if (!activeProvider.isConfigured()) {
    throw new AiNotConfiguredError();
  }
  try {
    return await withTimeout(activeProvider.chat(input), CHAT_TIMEOUT_MS);
  } catch (err) {
    if (err instanceof AiTimeoutError) throw err;
    throw new AiProviderError(err);
  }
}

/** Streaming counterpart — no timeout wrapper (a stream's lifetime is the caller's to bound, e.g.
 * via request abort), but the same not-configured guarantee. */
export function invokeAiStream(input: ChatInput): AsyncIterable<import("./ai-provider").ChatChunk> {
  if (!activeProvider.isConfigured()) {
    throw new AiNotConfiguredError();
  }
  return activeProvider.streamChat(input);
}
