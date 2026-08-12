import { type ImageCandidate, type ImageProvider, ImageProviderError } from "../image-provider";

/**
 * AI Image Discovery & Course Asset Management Phase 1 — the only `ImageProvider` implementation
 * this phase ships (see the phase's final report for why Unsplash was chosen over Pexels/Pixabay).
 *
 * Two compliance requirements shape this file, both load-bearing for how a selected image is later
 * persisted (`courses/course-service.ts`'s `setCourseImage`/`setLessonImage`):
 *   1. Unsplash's API Guidelines require every returned image to be hotlinked — its own `urls.*`
 *      values used directly, never downloaded and re-served from this application's own storage.
 *      That is exactly why `set_course_image`/`set_lesson_image` persist a `file_attachments` row of
 *      `kind: "link"` (a plain external URL), not `kind: "file"` (which would mean fetching the
 *      bytes and writing them into R2 — never done for an Unsplash-sourced image).
 *   2. Unsplash requires attribution (photographer name + link, and a link back to Unsplash) and a
 *      "download" tracking ping (`links.download_location`) at the moment a photo is actually used,
 *      not merely searched — `trackSelection` below issues that ping; `ai/tools/images.ts` calls it
 *      only inside `set_course_image`/`set_lesson_image`'s `execute()`, never during search.
 *
 * `license`/`licenseUrl` are a fixed constant, not per-photo data from the API — Unsplash's entire
 * catalog shares exactly one license (the "Unsplash License"), so hardcoding its name and the real,
 * stable URL to it is reporting a fact, not fabricating one.
 */
const SEARCH_ENDPOINT = "https://api.unsplash.com/search/photos";
const UNSPLASH_LICENSE = "Unsplash License";
const UNSPLASH_LICENSE_URL = "https://unsplash.com/license";

interface UnsplashUser {
  name?: string | null;
  links?: { html?: string | null };
}

interface UnsplashPhoto {
  id?: string;
  width?: number;
  height?: number;
  description?: string | null;
  alt_description?: string | null;
  urls?: { regular?: string; thumb?: string; small?: string };
  links?: { html?: string; download_location?: string };
  user?: UnsplashUser;
}

/** Maps one raw Unsplash search result to a normalized `ImageCandidate`, or `null` if the entry is
 * missing a field this application actually depends on (id, a usable image URL, dimensions) — an
 * individual malformed item is skipped, never allowed to fail the whole search (`ImageProvider`'s
 * own contract). */
function toCandidate(photo: UnsplashPhoto): ImageCandidate | null {
  if (!photo || typeof photo.id !== "string" || !photo.id.trim()) return null;
  const imageUrl = photo.urls?.regular;
  const previewUrl = photo.urls?.thumb ?? photo.urls?.small ?? imageUrl;
  if (!imageUrl || !previewUrl) return null;
  if (typeof photo.width !== "number" || typeof photo.height !== "number") return null;

  return {
    provider: "unsplash",
    providerImageId: photo.id,
    previewUrl,
    imageUrl,
    sourceUrl: photo.links?.html ?? `https://unsplash.com/photos/${photo.id}`,
    title: photo.description?.trim() || photo.alt_description?.trim() || null,
    width: photo.width,
    height: photo.height,
    author: photo.user?.name?.trim() || null,
    authorUrl: photo.user?.links?.html ?? null,
    license: UNSPLASH_LICENSE,
    licenseUrl: UNSPLASH_LICENSE_URL,
    selectionTrackingUrl: photo.links?.download_location ?? null,
  };
}

export class UnsplashProvider implements ImageProvider {
  isConfigured(): boolean {
    return !!process.env.IMAGE_PROVIDER_API_KEY;
  }

  private authHeader(): Record<string, string> {
    return { Authorization: `Client-ID ${process.env.IMAGE_PROVIDER_API_KEY}` };
  }

  async search(query: string, count: number): Promise<ImageCandidate[]> {
    const url = `${SEARCH_ENDPOINT}?query=${encodeURIComponent(query)}&per_page=${count}&content_filter=high`;
    let response: Response;
    try {
      response = await fetch(url, { headers: this.authHeader() });
    } catch (err) {
      throw new ImageProviderError(`Unsplash search request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!response.ok) {
      throw new ImageProviderError(`Unsplash search failed with status ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ImageProviderError("Unsplash returned a response that could not be parsed as JSON");
    }
    const results = (body as { results?: unknown })?.results;
    if (!Array.isArray(results)) {
      throw new ImageProviderError("Unsplash returned an unexpected response shape (missing results array)");
    }

    const candidates: ImageCandidate[] = [];
    for (const raw of results) {
      const candidate = toCandidate(raw as UnsplashPhoto);
      if (candidate) candidates.push(candidate);
    }
    return candidates;
  }

  async trackSelection(candidate: ImageCandidate): Promise<void> {
    if (!candidate.selectionTrackingUrl) return;
    try {
      await fetch(candidate.selectionTrackingUrl, { headers: this.authHeader() });
    } catch {
      // Best-effort per Unsplash's own guidelines' spirit and this provider's documented contract —
      // never let a tracking-ping failure block persisting the user's actual selection.
    }
  }
}
