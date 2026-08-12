import type { ImageCandidate, ImageProvider } from "./image-provider";
import { ImageProviderError } from "./image-provider";
import { UnsplashProvider } from "./providers/unsplash-provider";

/**
 * AI Image Discovery & Course Asset Management Phase 1 — the one thing `ai/tools/images.ts` calls;
 * it never talks to an `ImageProvider` directly, mirroring `ai/provider/invoke-ai.ts`'s own
 * relationship to `AiProvider`. `IMAGE_PROVIDER` selects the active implementation (today only
 * `"unsplash"` exists — see `.env.example`); a future second provider adds a branch here, not a
 * change to any AI tool.
 */
function createProvider(): ImageProvider {
  return new UnsplashProvider();
}

let activeProvider: ImageProvider = createProvider();

/** Test-only seam, same shape as `ai/provider/invoke-ai.ts`'s `__setAiProviderForTesting`. */
export function __setImageProviderForTesting(provider: ImageProvider): void {
  activeProvider = provider;
}

export type ImageSearchError = { code: "not_configured" | "provider_error"; message: string };
export type ImageSearchResult<T> = { ok: true; data: T } | { ok: false; error: ImageSearchError };

function ok<T>(data: T): ImageSearchResult<T> {
  return { ok: true, data };
}
function fail<T>(code: ImageSearchError["code"], message: string): ImageSearchResult<T> {
  return { ok: false, error: { code, message } };
}

/** Every search asks for the same, small, fixed count — matches the "Image 1/2/3/4" gallery UX this
 * phase's spec calls for; not a model- or caller-controlled parameter, so there's no way for a tool
 * call to request an unreasonably large result set. */
const DEFAULT_RESULT_COUNT = 5;

export const ImageSearchService = {
  isConfigured(): boolean {
    return activeProvider.isConfigured();
  },

  /** Never throws. A provider/network failure or an unconfigured provider both come back as a clean
   * `{ok:false}` the caller can turn into a clear tool-execution error — never a crash, and never a
   * silently-empty success (those are different, both-tested outcomes; see
   * `ai-foundation-image-discovery.test.ts`). */
  async search(query: string): Promise<ImageSearchResult<ImageCandidate[]>> {
    if (!activeProvider.isConfigured()) {
      return fail("not_configured", "Image search is not configured for this environment.");
    }
    try {
      const candidates = await activeProvider.search(query, DEFAULT_RESULT_COUNT);
      return ok(candidates);
    } catch (err) {
      const message = err instanceof ImageProviderError ? err.message : err instanceof Error ? err.message : "Image search failed.";
      return fail("provider_error", message);
    }
  },

  /** Fire-and-forget from the caller's point of view — see `ImageProvider.trackSelection`'s own
   * contract on why this never throws. */
  async trackSelection(candidate: ImageCandidate): Promise<void> {
    await activeProvider.trackSelection(candidate);
  },
};
