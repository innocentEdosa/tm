import { VIDEO_UPLOAD_PART_BATCH_SIZE } from "@tm/types";
import type { CourseEditorApi } from "./course-editor-adapter";
import { uploadFileToPresignedUrl } from "./tenant-api-client";

export class UploadCancelledError extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadCancelledError";
  }
}

const MAX_PART_RETRIES = 3;
const PART_RETRY_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** PUTs one multipart part directly to R2 and returns the ETag R2 hands back — required at
 * `complete` time to assemble the parts into one real object. Requires the R2 bucket's CORS config to
 * expose the `ETag` response header to browser JS (`Access-Control-Expose-Headers`); every other
 * presigned-upload flow in this app only ever checked success/failure, never read a response header
 * back, so this is a new operational requirement worth confirming is set. */
function uploadPart(url: string, chunk: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Part upload failed (${xhr.status})`));
        return;
      }
      const eTag = xhr.getResponseHeader("ETag");
      if (!eTag) {
        reject(new Error("Part upload succeeded but the server didn't return an ETag"));
        return;
      }
      resolve(eTag);
    };
    xhr.onerror = () => reject(new Error("Part upload failed"));
    xhr.send(chunk);
  });
}

async function uploadPartWithRetry(url: string, chunk: Blob, isCancelled: () => boolean): Promise<string> {
  let lastError: Error = new Error("Part upload failed");
  for (let attempt = 1; attempt <= MAX_PART_RETRIES; attempt++) {
    if (isCancelled()) throw new UploadCancelledError();
    try {
      return await uploadPart(url, chunk);
    } catch (err) {
      lastError = err as Error;
      if (attempt < MAX_PART_RETRIES) await sleep(PART_RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError;
}

function chunkRange(numbers: number[], size: number): number[][] {
  const batches: number[][] = [];
  for (let i = 0; i < numbers.length; i += size) {
    batches.push(numbers.slice(i, i + size));
  }
  return batches;
}

export interface UploadVideoFileOptions {
  onProgress?: (percent: number) => void;
  /** Checked before every part/batch — lets a caller cancel a multi-part upload already in progress
   * without a dedicated abort signal plumbed through every layer. Not checked mid-single-PUT (that
   * request has no natural pause point); a single-PUT video is, by construction, under the multipart
   * threshold and so finishes quickly regardless. */
  isCancelled?: () => boolean;
  /** Fired once `startVideoUpload` resolves — the caller's own "Cancel" button needs the attachment
   * id to actually call `api.abortVideoUpload` (releasing the R2 multipart session and the pending
   * row) rather than just walking away from it client-side. */
  onAttachmentIdKnown?: (attachmentId: string) => void;
}

/**
 * The one function a video-upload UI calls to upload a file — everything about single-PUT vs.
 * multipart (which one, how many parts, how they're batched/retried) is decided and handled in here,
 * driven entirely by what `api.startVideoUpload` returns. `video-form.tsx` never needs to branch on
 * strategy itself, matching the "clean upload video abstraction" this exists for.
 *
 * On failure partway through a multipart upload, the already-uploaded parts are simply left as-is in
 * R2 (not explicitly aborted) — the caller decides whether to retry (this function can be called
 * again for the SAME file; the server aborts the stale attempt and starts fresh, so retrying is
 * always safe, just not resumed from where it left off) or to call `api.abortVideoUpload` to give up
 * for good. Deliberately no cross-page-reload resumability — see the video upload feature's own notes
 * on why that's out of scope for this pass.
 */
export async function uploadVideoFile(api: CourseEditorApi, contentItemId: string, file: File, options: UploadVideoFileOptions = {}): Promise<{ attachmentId: string }> {
  if (!api.startVideoUpload || !api.completeVideoUpload) {
    throw new Error("Video upload is not supported here");
  }
  const { onProgress, isCancelled = () => false, onAttachmentIdKnown } = options;

  function checkCancelled() {
    if (isCancelled()) throw new UploadCancelledError();
  }

  checkCancelled();
  const start = await api.startVideoUpload(contentItemId, { fileName: file.name, contentType: file.type, sizeBytes: file.size });
  onAttachmentIdKnown?.(start.id);

  if (start.strategy === "single") {
    checkCancelled();
    await uploadFileToPresignedUrl(start.uploadUrl, file, file.type, onProgress);
    checkCancelled();
    await api.completeVideoUpload(start.id);
    return { attachmentId: start.id };
  }

  if (!api.getVideoPartUploadUrls) {
    throw new Error("Video upload is not supported here");
  }
  const { id: attachmentId, partSize, partCount } = start;
  const allPartNumbers = Array.from({ length: partCount }, (_, i) => i + 1);
  const completedParts: { partNumber: number; eTag: string }[] = [];
  let uploadedBytes = 0;

  for (const batch of chunkRange(allPartNumbers, VIDEO_UPLOAD_PART_BATCH_SIZE)) {
    checkCancelled();
    const urls = await api.getVideoPartUploadUrls(attachmentId, batch);
    for (const partNumber of batch) {
      checkCancelled();
      const rangeStart = (partNumber - 1) * partSize;
      const rangeEnd = Math.min(rangeStart + partSize, file.size);
      const chunk = file.slice(rangeStart, rangeEnd);
      const eTag = await uploadPartWithRetry(urls[partNumber], chunk, isCancelled);
      completedParts.push({ partNumber, eTag });
      uploadedBytes += chunk.size;
      onProgress?.(Math.round((uploadedBytes / file.size) * 100));
    }
  }

  checkCancelled();
  await api.completeVideoUpload(attachmentId, completedParts);
  return { attachmentId };
}
