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
  /** Server-side direct write — unlike every method above, the API server itself is the caller, not a
   * client via a presigned URL. Used by the SCORM Runtime spec to upload extracted package files
   * (research.md §3, spec 027). */
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Server-side direct read, streamed — backs the SCORM package file-proxy route (research.md §3/§7,
   * spec 027). Returns `null` if the object doesn't exist. */
  getObjectStream(key: string): Promise<{ stream: NodeJS.ReadableStream; contentType?: string } | null>;
}
