/**
 * A fixed, platform-wide, in-code allowlist (research.md §7, File Upload & Storage spec) — not
 * tenant-configurable in this spec (spec Constitution Alignment). Keyed by `entity_type`; only
 * `content_item` is wired today. A future entity type (e.g. the SCORM Runtime spec's package uploads)
 * adds its own entry here rather than loosening this one (spec Assumptions).
 */
const ALLOWLIST: Record<string, { contentTypes: string[]; maxSizeBytes: number }> = {
  content_item: {
    contentTypes: ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"],
    maxSizeBytes: 25 * 1024 * 1024, // 25 MB
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
