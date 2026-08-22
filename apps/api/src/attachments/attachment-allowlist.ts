import { MAX_VIDEO_SIZE_BYTES } from "../storage/multipart-config";

/**
 * A fixed, platform-wide, in-code allowlist (research.md §7, File Upload & Storage spec) — not
 * tenant-configurable in this spec (spec Constitution Alignment). Keyed by `entity_type`. A future
 * entity type adds its own entry here rather than loosening an existing one (spec Assumptions).
 * `course` (course thumbnail) and `course_author` (profile photo) are image-only with a tighter cap
 * than `content_item`'s general-purpose allowance — neither needs PDF support or 25 MB of headroom.
 */
const ALLOWLIST: Record<string, { contentTypes: string[]; maxSizeBytes: number }> = {
  content_item: {
    contentTypes: ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"],
    maxSizeBytes: 25 * 1024 * 1024, // 25 MB
  },
  course: {
    contentTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
    maxSizeBytes: 5 * 1024 * 1024, // 5 MB
  },
  course_author: {
    contentTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
    maxSizeBytes: 5 * 1024 * 1024, // 5 MB
  },
  /** Video Lesson Upload — a course-editor lesson's own uploaded video, distinct from `content_item`'s
   * generic lesson-resource allowance above (images/PDF, 25 MB): a video is never a "resource," it's
   * the lesson's primary content, and needs both a much larger cap and a completely different
   * content-type set. Deliberately NOT every `video/*` MIME type — only formats HTML5 `<video>` can
   * actually play natively in a browser without this app growing a transcoding pipeline it doesn't
   * have (research: mp4/webm/quicktime cover the practical range; avi/mkv/etc. are excluded on
   * purpose, not an oversight). 5 GiB keeps comfortably under the multipart-upload part-count/size
   * math in `storage/multipart-config.ts` while being generous for a real lesson recording. */
  content_item_video: {
    contentTypes: ["video/mp4", "video/webm", "video/quicktime"],
    maxSizeBytes: MAX_VIDEO_SIZE_BYTES,
  },
  /** AI-Assisted Course Generation's "Or upload document containing description" input — a syllabus
   * PDF/DOCX, or an image the model reads as multimodal input (`ai/course-generation-routes.ts`).
   * Not a real `file_attachments` row/entity — the upload is ephemeral (read once for its content,
   * then deleted; see that route's own doc comment), but reuses this same allowlist mechanism rather
   * than inventing a parallel validation path. 10 MB matches what the modal's own UI already
   * advertises. */
  ai_course_generation_document: {
    contentTypes: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/jpeg", "image/png", "image/webp"],
    maxSizeBytes: 10 * 1024 * 1024, // 10 MB
  },
};

export function validateAgainstAllowlist(
  entityType: string,
  contentType: string,
  sizeBytes: number,
): { error: string | null } {
  const rule = ALLOWLIST[entityType];
  if (!rule) {
    return { error: `No upload allowlist configured for entity type "${entityType}"` };
  }
  if (!rule.contentTypes.includes(contentType)) {
    return { error: `contentType "${contentType}" is not allowed for ${entityType} attachments` };
  }
  if (sizeBytes > rule.maxSizeBytes) {
    return { error: `sizeBytes exceeds the ${rule.maxSizeBytes}-byte limit for ${entityType} attachments` };
  }
  return { error: null };
}

/** Video-only defense-in-depth: a `Content-Type` header is entirely client-asserted, so this cross-
 * checks the uploaded file's own name against the extension(s) real `content_item_video`-allowed
 * MIME type actually implies — catches a mismatched/spoofed header (e.g. a `.exe` renamed to claim
 * `video/mp4`) that `validateAgainstAllowlist` alone can't. Not applied to the older allowlist
 * entries above — scoped to this new upload path only, not an unrelated retrofit. */
const VIDEO_EXTENSIONS_BY_CONTENT_TYPE: Record<string, string[]> = {
  "video/mp4": [".mp4"],
  "video/webm": [".webm"],
  "video/quicktime": [".mov", ".qt"],
};

export function validateVideoFileExtension(fileName: string, contentType: string): { error: string | null } {
  const allowedExtensions = VIDEO_EXTENSIONS_BY_CONTENT_TYPE[contentType];
  if (!allowedExtensions) {
    return { error: `contentType "${contentType}" is not an allowed video type` };
  }
  const lowerName = fileName.toLowerCase();
  if (!allowedExtensions.some((ext) => lowerName.endsWith(ext))) {
    return { error: `File extension does not match contentType "${contentType}" (expected ${allowedExtensions.join(" or ")})` };
  }
  return { error: null };
}
