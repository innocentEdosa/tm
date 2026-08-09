/** Mirrors `apps/api/src/attachments/attachment-allowlist.ts`'s per-entity-type content-type lists —
 * kept in sync by hand (same duplication pattern as `RESOURCE_ALLOWLIST_ACCEPT`/the course-image
 * field's `accept` attribute already use for the native file picker). Used to filter an "existing
 * files" picker down to only the types actually reusable in that context, regardless of which section
 * originally uploaded them. */
export const IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
/** `content_item` attachments (lesson resources) additionally allow PDF, per the backend allowlist. */
export const CONTENT_ITEM_RESOURCE_CONTENT_TYPES = [...IMAGE_CONTENT_TYPES, "application/pdf"];

export function formatFileSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** e.g. "application/pdf" -> "PDF", "image/png" -> "PNG" — a short type tag for a file picker row/thumbnail. */
export function formatFileType(contentType: string | null): string {
  if (!contentType) return "File";
  const subtype = contentType.split("/")[1] ?? contentType;
  return subtype.toUpperCase();
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
}
