import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnsplashProvider } from "../../src/images/providers/unsplash-provider";
import { ImageProviderError } from "../../src/images/image-provider";

const ORIGINAL_ENV = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function rawPhoto(overrides: Record<string, unknown> = {}) {
  return {
    id: "abc123",
    width: 1200,
    height: 800,
    description: "A team collaborating",
    alt_description: "people around a table",
    urls: { regular: "https://images.unsplash.com/abc123-regular", thumb: "https://images.unsplash.com/abc123-thumb" },
    links: { html: "https://unsplash.com/photos/abc123", download_location: "https://api.unsplash.com/photos/abc123/download" },
    user: { name: "Jane Doe", links: { html: "https://unsplash.com/@janedoe" } },
    ...overrides,
  };
}

describe("UnsplashProvider", () => {
  beforeEach(() => {
    setEnv({ IMAGE_PROVIDER_API_KEY: "test-access-key" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  describe("isConfigured", () => {
    it("true when IMAGE_PROVIDER_API_KEY is set", () => {
      expect(new UnsplashProvider().isConfigured()).toBe(true);
    });
    it("false when unset", () => {
      setEnv({ IMAGE_PROVIDER_API_KEY: undefined });
      expect(new UnsplashProvider().isConfigured()).toBe(false);
    });
  });

  describe("search", () => {
    it("sends the query, per_page, and Client-ID auth header, and normalizes a real result shape", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [rawPhoto()] }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const candidates = await new UnsplashProvider().search("servant leadership workplace", 5);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain("query=servant%20leadership%20workplace");
      expect(String(url)).toContain("per_page=5");
      expect((init as RequestInit).headers).toMatchObject({ Authorization: "Client-ID test-access-key" });

      expect(candidates).toEqual([
        {
          provider: "unsplash",
          providerImageId: "abc123",
          previewUrl: "https://images.unsplash.com/abc123-thumb",
          imageUrl: "https://images.unsplash.com/abc123-regular",
          sourceUrl: "https://unsplash.com/photos/abc123",
          title: "A team collaborating",
          width: 1200,
          height: 800,
          author: "Jane Doe",
          authorUrl: "https://unsplash.com/@janedoe",
          license: "Unsplash License",
          licenseUrl: "https://unsplash.com/license",
          selectionTrackingUrl: "https://api.unsplash.com/photos/abc123/download",
        },
      ]);
    });

    it("falls back to alt_description when description is absent, and to null when neither exists", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [rawPhoto({ description: null })] }), { status: 200 })));
      const [withAlt] = await new UnsplashProvider().search("x", 1);
      expect(withAlt.title).toBe("people around a table");

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [rawPhoto({ description: null, alt_description: null })] }), { status: 200 })));
      const [withNeither] = await new UnsplashProvider().search("x", 1);
      expect(withNeither.title).toBeNull();
    });

    it("returns an empty array for zero results — not an error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 })));
      const candidates = await new UnsplashProvider().search("a query with no matches", 5);
      expect(candidates).toEqual([]);
    });

    it("skips an individual malformed result item rather than failing the whole search", async () => {
      const malformed = { id: "missing-fields-only" }; // no urls, no width/height
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [malformed, rawPhoto()] }), { status: 200 })));
      const candidates = await new UnsplashProvider().search("x", 5);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].providerImageId).toBe("abc123");
    });

    it("throws ImageProviderError on a non-2xx response", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 })));
      await expect(new UnsplashProvider().search("x", 5)).rejects.toBeInstanceOf(ImageProviderError);
    });

    it("throws ImageProviderError when the response body isn't valid JSON", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 200 })));
      await expect(new UnsplashProvider().search("x", 5)).rejects.toBeInstanceOf(ImageProviderError);
    });

    it("throws ImageProviderError when the response is valid JSON but missing a results array", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ unexpected: "shape" }), { status: 200 })));
      await expect(new UnsplashProvider().search("x", 5)).rejects.toBeInstanceOf(ImageProviderError);
    });

    it("throws ImageProviderError when fetch itself rejects (network failure)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unreachable")));
      await expect(new UnsplashProvider().search("x", 5)).rejects.toBeInstanceOf(ImageProviderError);
    });
  });

  describe("trackSelection", () => {
    it("pings the candidate's selectionTrackingUrl with auth", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      await new UnsplashProvider().trackSelection({
        provider: "unsplash",
        providerImageId: "abc123",
        previewUrl: "x",
        imageUrl: "x",
        sourceUrl: "x",
        title: null,
        width: 1,
        height: 1,
        author: null,
        authorUrl: null,
        license: null,
        licenseUrl: null,
        selectionTrackingUrl: "https://api.unsplash.com/photos/abc123/download",
      });
      expect(fetchMock).toHaveBeenCalledWith("https://api.unsplash.com/photos/abc123/download", expect.objectContaining({ headers: { Authorization: "Client-ID test-access-key" } }));
    });

    it("is a no-op (never throws) when selectionTrackingUrl is null", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      await expect(
        new UnsplashProvider().trackSelection({
          provider: "unsplash",
          providerImageId: "abc123",
          previewUrl: "x",
          imageUrl: "x",
          sourceUrl: "x",
          title: null,
          width: 1,
          height: 1,
          author: null,
          authorUrl: null,
          license: null,
          licenseUrl: null,
          selectionTrackingUrl: null,
        }),
      ).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("never throws even if the tracking ping itself fails", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unreachable")));
      await expect(
        new UnsplashProvider().trackSelection({
          provider: "unsplash",
          providerImageId: "abc123",
          previewUrl: "x",
          imageUrl: "x",
          sourceUrl: "x",
          title: null,
          width: 1,
          height: 1,
          author: null,
          authorUrl: null,
          license: null,
          licenseUrl: null,
          selectionTrackingUrl: "https://api.unsplash.com/photos/abc123/download",
        }),
      ).resolves.toBeUndefined();
    });
  });
});
