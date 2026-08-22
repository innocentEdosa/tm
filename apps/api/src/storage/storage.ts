import type { StorageClient } from "./storage-client";
import { R2StorageClient } from "./r2-client";

let activeClient: StorageClient = new R2StorageClient();

/** Test-only seam — never called outside tests. Mirrors `tenant-auth/mailer.ts`'s
 * `__setMailSenderForTesting` precedent: lets tests install a fake `StorageClient` so route handlers
 * never need real R2 credentials to be exercised (research.md §2/§9). */
export function __setStorageClientForTesting(client: StorageClient): void {
  activeClient = client;
}

/**
 * Unlike `mailer.ts`'s `sendMail` (which silently skips when unconfigured, since email is a
 * best-effort side effect), storage has no fallback path that still delivers this feature's value —
 * callers MUST check `isStorageConfigured()` themselves and respond `503` before attempting any
 * operation below (research.md §8).
 */
export function isStorageConfigured(): boolean {
  return activeClient.isConfigured();
}

export function createPresignedUploadUrl(key: string, contentType: string, sizeBytes: number): Promise<string> {
  return activeClient.createPresignedUploadUrl(key, contentType, sizeBytes);
}

export function headObject(key: string): Promise<{ exists: boolean; sizeBytes?: number }> {
  return activeClient.headObject(key);
}

export function createPresignedDownloadUrl(key: string, expirySecondsOverride?: number): Promise<string> {
  return activeClient.createPresignedDownloadUrl(key, expirySecondsOverride);
}

export function deleteObject(key: string): Promise<void> {
  return activeClient.deleteObject(key);
}

export function createMultipartUpload(key: string, contentType: string): Promise<string> {
  return activeClient.createMultipartUpload(key, contentType);
}

export function createPresignedUploadPartUrls(key: string, uploadId: string, partNumbers: number[]): Promise<Record<number, string>> {
  return activeClient.createPresignedUploadPartUrls(key, uploadId, partNumbers);
}

export function completeMultipartUpload(key: string, uploadId: string, parts: { partNumber: number; eTag: string }[]): Promise<void> {
  return activeClient.completeMultipartUpload(key, uploadId, parts);
}

export function abortMultipartUpload(key: string, uploadId: string): Promise<void> {
  return activeClient.abortMultipartUpload(key, uploadId);
}

export function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  return activeClient.putObject(key, body, contentType);
}

export function getObjectStream(key: string): Promise<{ stream: NodeJS.ReadableStream; contentType?: string } | null> {
  return activeClient.getObjectStream(key);
}
