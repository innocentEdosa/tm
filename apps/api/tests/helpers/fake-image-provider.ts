import type { ImageCandidate, ImageProvider } from "../../src/images/image-provider";

/** A realistic, fully-populated candidate for tests that don't care about the specific field
 * values — override only what a given test needs to vary. */
export function fakeCandidate(overrides: Partial<ImageCandidate> = {}): ImageCandidate {
  return {
    provider: "unsplash",
    providerImageId: "fake-1",
    previewUrl: "https://images.example.com/fake-1-thumb",
    imageUrl: "https://images.example.com/fake-1-regular",
    sourceUrl: "https://unsplash.com/photos/fake-1",
    title: "A fake test image",
    width: 1200,
    height: 800,
    author: "Test Photographer",
    authorUrl: "https://unsplash.com/@testphotographer",
    license: "Unsplash License",
    licenseUrl: "https://unsplash.com/license",
    selectionTrackingUrl: "https://api.unsplash.com/photos/fake-1/download",
    ...overrides,
  };
}

/** Test-only `ImageProvider`, installed via `__setImageProviderForTesting` — same shape as
 * `ScriptedProvider` for the AI chat provider. Never makes a real network call. */
export class FakeImageProvider implements ImageProvider {
  public trackedSelections: ImageCandidate[] = [];
  public searchCalls: { query: string; count: number }[] = [];
  private configured = true;
  private results: ImageCandidate[] | Error = [];

  setConfigured(value: boolean): void {
    this.configured = value;
  }
  setResults(results: ImageCandidate[] | Error): void {
    this.results = results;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async search(query: string, count: number): Promise<ImageCandidate[]> {
    this.searchCalls.push({ query, count });
    if (this.results instanceof Error) throw this.results;
    return this.results.slice(0, count);
  }

  async trackSelection(candidate: ImageCandidate): Promise<void> {
    this.trackedSelections.push(candidate);
  }
}
