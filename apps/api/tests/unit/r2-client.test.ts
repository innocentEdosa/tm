import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { R2StorageClient } from "../../src/storage/r2-client";

const ORIGINAL_ENV = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("R2StorageClient (research.md §1/§2/§6, File Upload & Storage spec)", () => {
  beforeEach(() => {
    setEnv({
      R2_ACCOUNT_ID: "test-account",
      R2_ACCESS_KEY_ID: "test-access-key",
      R2_SECRET_ACCESS_KEY: "test-secret-key",
      R2_BUCKET_NAME: "test-bucket",
    });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe("isConfigured", () => {
    it("returns true when all four R2_* vars are set", () => {
      expect(new R2StorageClient().isConfigured()).toBe(true);
    });

    it.each(["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"])(
      "returns false when %s is missing",
      (key) => {
        setEnv({ [key]: undefined });
        expect(new R2StorageClient().isConfigured()).toBe(false);
      },
    );

    it("returns false when a required var is set to an empty string", () => {
      setEnv({ R2_ACCOUNT_ID: "" });
      expect(new R2StorageClient().isConfigured()).toBe(false);
    });
  });

  describe("presigned URL request-shaping (no real network call — signing is a pure local operation)", () => {
    it("createPresignedUploadUrl scopes the URL to the given key and R2's account-derived endpoint", async () => {
      const url = await new R2StorageClient().createPresignedUploadUrl("tenant/content_item/item-1/att-1/file.pdf", "application/pdf", 100);
      expect(url).toContain("test-account.r2.cloudflarestorage.com");
      expect(url).toContain("test-bucket");
      expect(url).toContain(encodeURIComponent("tenant/content_item/item-1/att-1/file.pdf").replace(/%2F/g, "/"));
    });

    it("createPresignedDownloadUrl scopes the URL to the given key", async () => {
      const url = await new R2StorageClient().createPresignedDownloadUrl("tenant/content_item/item-1/att-1/file.pdf");
      expect(url).toContain("test-account.r2.cloudflarestorage.com");
      expect(url).toContain("test-bucket");
    });
  });
});
