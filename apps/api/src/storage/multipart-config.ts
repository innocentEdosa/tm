import { VIDEO_UPLOAD_PART_BATCH_SIZE } from "@tm/types";

/**
 * Single source of truth for every multipart-upload-related constant (Video Lesson Upload feature).
 * R2 implements the S3 multipart API, so these mirror S3's own hard constraints:
 * - A part (other than the last) must be at least 5 MiB.
 * - At most 10,000 parts per upload.
 * - A presigned URL expiry that's long enough for a slow connection to actually finish uploading.
 *
 * `MULTIPART_THRESHOLD_BYTES` is the only thing callers need to reason about — everything at or
 * above it uses multipart; everything below reuses the existing single presigned-PUT flow
 * (`storage.createPresignedUploadUrl`). Neither the API route nor the client upload code needs its
 * own copy of this decision; `resolveVideoUploadStrategy` below is the one place it's made.
 */
export const MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024; // 100 MiB
export const MULTIPART_PART_SIZE_BYTES = 16 * 1024 * 1024; // 16 MiB — comfortably above the 5 MiB S3/R2 minimum
export const MULTIPART_MAX_PARTS = 10_000; // S3/R2's own hard ceiling

/** Re-exported from `@tm/types` (not redefined here) — the web client needs the exact same number to
 * pace its own upload loop, so this lives in the one package both sides already share. */
export const MULTIPART_PART_BATCH_SIZE = VIDEO_UPLOAD_PART_BATCH_SIZE;

/** Long-lived — a part upload can be one of hundreds for a multi-GB file on a slow connection; the
 * default single-object upload expiry (15 minutes, `r2-client.ts`) is tuned for a single whole-file
 * PUT, not a long-running batch-by-batch multipart session. */
export const MULTIPART_PART_URL_EXPIRY_SECONDS = 6 * 3600; // 6 hours

/** Product-level cap on an uploaded video, independent of the multipart mechanics above — chosen to
 * stay well under `MULTIPART_MAX_PARTS * MULTIPART_PART_SIZE_BYTES` (~160 GB) with a lot of
 * headroom, not because R2 itself couldn't go higher. */
export const MAX_VIDEO_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GiB

/** Longer than `createPresignedDownloadUrl`'s own default (1 hour, `r2-client.ts`) — a `<video>` tag
 * keeps re-requesting byte ranges from the SAME src URL for as long as playback continues, unlike a
 * document that's fetched once and done. A 1-hour link would break mid-playback of anything longer
 * than an hour; this is passed as `download-url`'s `expirySecondsOverride` specifically when the
 * attachment being downloaded is a video. */
export const VIDEO_DOWNLOAD_URL_EXPIRY_SECONDS = 4 * 3600; // 4 hours

export type VideoUploadStrategy = "single" | "multipart";

/** The one place "should this upload be multipart" is decided — every caller (the start-upload
 * route today, anything else later) asks this instead of comparing against the threshold itself. */
export function resolveVideoUploadStrategy(sizeBytes: number): VideoUploadStrategy {
  return sizeBytes >= MULTIPART_THRESHOLD_BYTES ? "multipart" : "single";
}

/** Ceiling-division part count for a given file size — the last part is whatever remains (always
 * `<= MULTIPART_PART_SIZE_BYTES`, and `> 0` as long as `sizeBytes > 0`, which every caller already
 * validates before reaching this). */
export function computePartCount(sizeBytes: number): number {
  return Math.ceil(sizeBytes / MULTIPART_PART_SIZE_BYTES);
}
