/**
 * AI Image Discovery & Course Asset Management Phase 1 — the provider-agnostic contract the AI
 * layer depends on, mirroring `ai/provider/ai-provider.ts`'s own `AiProvider` interface (Anthropic vs
 * OpenAI) one level down: `ImageSearchService` (images/image-search-service.ts) is the only thing
 * that ever calls a concrete `ImageProvider`; `ai/tools/images.ts` only ever calls
 * `ImageSearchService`, never a provider directly. Swapping Unsplash for a different provider later
 * means writing a new `ImageProvider` implementation — no change to the AI tools, `ImageSearchService`,
 * or anything that persists a selected image.
 */

/**
 * A normalized search result, independent of which provider produced it. Every field here is either
 * something the provider actually returned (never fabricated) or explicitly optional/nullable when a
 * provider doesn't supply it — there is no "best guess" field. `license`/`licenseUrl` are populated
 * only when the provider has one real, attributable license to report (for a provider whose entire
 * catalog shares one fixed license — e.g. Unsplash — this is a real constant, not an invented value);
 * a provider with no reliable per-image licensing information would leave these `null` rather than
 * this type (or any provider) ever guessing.
 */
export interface ImageCandidate {
  /** Which `ImageProvider` produced this — e.g. `"unsplash"`. Lets a mixed-provider future (or just
   * honest display: "via Unsplash") work without the AI tool needing provider-specific knowledge. */
  provider: string;
  /** The provider's own stable identifier for this image — the ONLY thing a caller is ever allowed
   * to use to re-select this exact candidate later (see `ai/tools/images.ts`'s
   * `resolveCandidateFromRecentSearches` — never the model-echoed `imageUrl`). */
  providerImageId: string;
  /** A small/fast-loading version for a gallery-style "Image 1/2/3/4" picker. */
  previewUrl: string;
  /** The full-size URL that gets persisted if this candidate is selected — always the provider's own
   * hotlink URL, never rewritten or re-hosted by this application unless a future provider's terms
   * require that (see `UnsplashProvider`'s own doc comment on why Unsplash specifically must NOT be
   * re-hosted). */
  imageUrl: string;
  /** The provider's own page for this image (attribution link target) — e.g. its Unsplash photo page. */
  sourceUrl: string;
  /** Provider-supplied description/alt-text, if any — never invented when the provider gives none. */
  title: string | null;
  width: number;
  height: number;
  /** Photographer/creator display name, if the provider supplies one. */
  author: string | null;
  /** Link to the author's own profile/page, if the provider supplies one. */
  authorUrl: string | null;
  license: string | null;
  licenseUrl: string | null;
  /** Opaque, provider-specific hook some providers require to be pinged at SELECTION time (not
   * search time) — e.g. Unsplash's download-tracking endpoint. Never shown to the model/user; only
   * `ImageSearchService.trackSelection` ever reads it. `null` for a provider with no such
   * requirement. */
  selectionTrackingUrl: string | null;
}

export class ImageProviderError extends Error {}

export interface ImageProvider {
  isConfigured(): boolean;
  /** Returns at most `count` normalized candidates for a search query. Must never throw for "zero
   * results" (an empty array is a valid, successful outcome) — only for a genuine provider/network
   * failure, which `ImageSearchService` turns into a clean, non-crashing result the caller can
   * report to the user. Must defensively skip (not crash on) any individual malformed result item
   * from the provider rather than fail the whole search over one bad entry. */
  search(query: string, count: number): Promise<ImageCandidate[]>;
  /** Best-effort provider-required "this image was selected" notification (e.g. Unsplash's download
   * tracking). Must never throw — a tracking-ping failure must never block persisting the user's
   * actual selection, which is the real operation the user asked for. No-op for a provider with no
   * such requirement. */
  trackSelection(candidate: ImageCandidate): Promise<void>;
}
