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
  /** One entry per `createMultipartUpload` call — lets a test recover the storage key a multipart
   * upload was started against without needing to know the internal (server-only, never exposed over
   * HTTP) `uploadId` itself. */
  readonly multipartStarted: { key: string; contentType: string }[] = [];
  /** One unified backing store for every key this fixture treats as "actually present" — populated
   * either by `simulateUpload` (mimicking a client's direct presigned-URL PUT) or by `putObject`
   * (server-side direct writes, spec 027's SCORM package-file storage). `body` is optional because
   * specs 023-026's own tests only ever needed size, not real bytes, for `headObject` verification. */
  private readonly objects = new Map<string, { sizeBytes: number; body?: Buffer; contentType?: string }>();
  /** One in-memory session per `createMultipartUpload` call, keyed by the fake `uploadId` it hands
   * back — tracks which parts a test has "uploaded" via `simulateUploadPart` so `completeMultipartUpload`
   * can assemble a real total size the same way R2 would from the actual bytes. */
  private readonly multipartSessions = new Map<string, { key: string; parts: Map<number, number> }>();
  private multipartCounter = 0;

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

  async createMultipartUpload(key: string, contentType: string): Promise<string> {
    this.multipartCounter += 1;
    const uploadId = `multipart-${this.multipartCounter}`;
    this.multipartSessions.set(uploadId, { key, parts: new Map() });
    this.multipartStarted.push({ key, contentType });
    return uploadId;
  }

  async createPresignedUploadPartUrls(key: string, uploadId: string, partNumbers: number[]): Promise<Record<number, string>> {
    return Object.fromEntries(partNumbers.map((n) => [n, `https://recording-storage.test/upload-part/${encodeURIComponent(uploadId)}/${n}`]));
  }

  /** Test helper — simulates a client having PUT one part's bytes to R2 (mirrors `simulateUpload`'s
   * role for a plain single-PUT upload). Identified by storage KEY, not the internal `uploadId` (a
   * test only ever sees the key — `uploadId` is server-only, never returned over HTTP). Sums recorded
   * parts in `completeMultipartUpload` to produce the final object's reported size, the same way R2
   * assembles real parts into one object. */
  simulateUploadPart(key: string, partNumber: number, sizeBytes: number): void {
    const session = [...this.multipartSessions.values()].find((s) => s.key === key);
    if (!session) throw new Error(`No in-progress multipart session for key: ${key}`);
    session.parts.set(partNumber, sizeBytes);
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: { partNumber: number; eTag: string }[]): Promise<void> {
    const session = this.multipartSessions.get(uploadId);
    if (!session) throw new Error(`No such multipart session: ${uploadId}`);
    const totalSize = parts.reduce((sum, p) => {
      const partSize = session.parts.get(p.partNumber);
      if (partSize === undefined) throw new Error(`Part ${p.partNumber} was never uploaded in session ${uploadId}`);
      return sum + partSize;
    }, 0);
    this.objects.set(key, { sizeBytes: totalSize });
    this.multipartSessions.delete(uploadId);
  }

  async abortMultipartUpload(_key: string, uploadId: string): Promise<void> {
    this.multipartSessions.delete(uploadId);
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
