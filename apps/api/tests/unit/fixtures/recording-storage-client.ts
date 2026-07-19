import { Readable } from "node:stream";
import type { StorageClient } from "../../../src/storage/storage-client";

/**
 * A minimal, throwaway `StorageClient` — proves a provider swap needs nothing but a new file
 * implementing this interface (research.md §2, File Upload & Storage spec). Never wired in outside
 * tests; records what it received and simulates a real object store in memory instead of calling R2.
 * Mirrors `recording-mail-sender.ts`'s `RecordingMailSender`.
 */
export class RecordingStorageClient implements StorageClient {
  readonly uploadedKeys: { key: string; contentType: string; sizeBytes: number }[] = [];
  readonly deletedKeys: string[] = [];
  /** One unified backing store for every key this fixture treats as "actually present" — populated
   * either by `simulateUpload` (mimicking a client's direct presigned-URL PUT) or by `putObject`
   * (server-side direct writes, spec 027's SCORM package-file storage). `body` is optional because
   * specs 023-026's own tests only ever needed size, not real bytes, for `headObject` verification. */
  private readonly objects = new Map<string, { sizeBytes: number; body?: Buffer; contentType?: string }>();

  isConfigured(): boolean {
    return true;
  }

  async createPresignedUploadUrl(key: string, contentType: string, sizeBytes: number): Promise<string> {
    this.uploadedKeys.push({ key, contentType, sizeBytes });
    return `https://recording-storage.test/upload/${encodeURIComponent(key)}`;
  }

  /** Test helper — simulates the client having actually PUT the file's bytes to the given key, so a
   * subsequent `headObject` call reports it as present with the given size. Pass `body` when the test
   * also needs `getObjectStream` to later read the bytes back (e.g. spec 027's raw-package import
   * flow) — omit it for the simpler size-only verification specs 023-026's tests use. */
  simulateUpload(key: string, sizeBytes: number, body?: Buffer): void {
    this.objects.set(key, { sizeBytes, body, contentType: body ? "application/octet-stream" : undefined });
  }

  async headObject(key: string): Promise<{ exists: boolean; sizeBytes?: number }> {
    const entry = this.objects.get(key);
    if (!entry) {
      return { exists: false };
    }
    return { exists: true, sizeBytes: entry.sizeBytes };
  }

  async createPresignedDownloadUrl(key: string): Promise<string> {
    return `https://recording-storage.test/download/${encodeURIComponent(key)}`;
  }

  async deleteObject(key: string): Promise<void> {
    this.deletedKeys.push(key);
    this.objects.delete(key);
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { sizeBytes: body.length, body, contentType });
  }

  async getObjectStream(key: string): Promise<{ stream: NodeJS.ReadableStream; contentType?: string } | null> {
    const entry = this.objects.get(key);
    if (!entry?.body) {
      return null;
    }
    return { stream: Readable.from(entry.body), contentType: entry.contentType };
  }
}
