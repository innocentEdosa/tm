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
  /** Returns a presigned URL the client GETs the file's bytes from directly. `expirySecondsOverride`
   * lets a caller ask for a longer-lived link than the provider's own default (e.g. video playback,
   * which can keep re-requesting byte ranges from the same URL well past a short document-download
   * expiry) — omit it to get the provider's normal default. */
  createPresignedDownloadUrl(key: string, expirySecondsOverride?: number): Promise<string>;
  deleteObject(key: string): Promise<void>;

  /** Starts a multipart upload session and returns its `uploadId` — the handle every other
   * multipart method below needs. */
  createMultipartUpload(key: string, contentType: string): Promise<string>;
  /** Presigns exactly the requested part numbers (not the whole upload's worth) — callers ask for
   * more in batches as an upload progresses, per `multipart-config.ts`'s own reasoning. */
  createPresignedUploadPartUrls(key: string, uploadId: string, partNumbers: number[]): Promise<Record<number, string>>;
  /** Assembles the uploaded parts into one real object. `parts` must be sorted by `partNumber` and
   * cover every part the client actually uploaded — the ETag for each comes from that part's own
   * PUT response, not something the server can compute itself. */
  completeMultipartUpload(key: string, uploadId: string, parts: { partNumber: number; eTag: string }[]): Promise<void>;
  /** Cancels an in-progress multipart upload and releases whatever parts R2 was holding for it — the
   * upload's own storage key is never a real object until `completeMultipartUpload` runs, so this is
   * the only way to reclaim that space if the caller gives up partway through. */
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
  /** Server-side direct write — unlike every method above, the API server itself is the caller, not a
   * client via a presigned URL. Used by the SCORM Runtime spec to upload extracted package files
   * (research.md §3, spec 027). */
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Server-side direct read, streamed — backs the SCORM package file-proxy route (research.md §3/§7,
   * spec 027). Returns `null` if the object doesn't exist. */
  getObjectStream(key: string): Promise<{ stream: NodeJS.ReadableStream; contentType?: string } | null>;
}
