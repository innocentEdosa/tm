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
  /** Keys the fixture treats as "actually uploaded" once `simulateUpload` is called — lets a test
   * control whether a subsequent `headObject`/confirm call finds a real object or not. */
  private readonly objects = new Map<string, number>();

  isConfigured(): boolean {
    return true;
  }

  async createPresignedUploadUrl(key: string, contentType: string, sizeBytes: number): Promise<string> {
    this.uploadedKeys.push({ key, contentType, sizeBytes });
    return `https://recording-storage.test/upload/${encodeURIComponent(key)}`;
  }

  /** Test helper — simulates the client having actually PUT the file's bytes to the given key, so a
   * subsequent `headObject` call reports it as present with the given size. */
  simulateUpload(key: string, sizeBytes: number): void {
    this.objects.set(key, sizeBytes);
  }

  async headObject(key: string): Promise<{ exists: boolean; sizeBytes?: number }> {
    if (!this.objects.has(key)) {
      return { exists: false };
    }
    return { exists: true, sizeBytes: this.objects.get(key) };
  }

  async createPresignedDownloadUrl(key: string): Promise<string> {
    return `https://recording-storage.test/download/${encodeURIComponent(key)}`;
  }

  async deleteObject(key: string): Promise<void> {
    this.deletedKeys.push(key);
    this.objects.delete(key);
  }
}
