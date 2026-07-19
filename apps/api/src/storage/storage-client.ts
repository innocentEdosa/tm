/**
 * The provider-agnostic contract every storage adapter implements (research.md §2, File Upload &
 * Storage spec). `storage.ts`'s exported functions delegate through exactly this interface — a future
 * provider swap means adding one new implementation of `StorageClient` and changing which one is wired
 * in there, never touching a call site. Mirrors `mail/mail-sender.ts`'s `MailSender` interface shape.
 */
export interface StorageClient {
  /** MUST return false whenever any credential this provider needs is missing/empty, and MUST NOT
   * perform a network call to determine this. */
  isConfigured(): boolean;
  /** Returns a presigned URL the client PUTs the file's bytes to directly. */
  createPresignedUploadUrl(key: string, contentType: string, sizeBytes: number): Promise<string>;
  /** Verifies the object exists in storage and reports its real size, for confirm-upload verification
   * (spec FR-004). */
  headObject(key: string): Promise<{ exists: boolean; sizeBytes?: number }>;
  /** Returns a presigned URL the client GETs the file's bytes from directly. */
  createPresignedDownloadUrl(key: string): Promise<string>;
  deleteObject(key: string): Promise<void>;
}
