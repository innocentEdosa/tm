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
