export type ContentItemType = "video" | "article" | "live_class" | "test" | "assignment" | "external_import";

export const CONTENT_ITEM_TYPES: ContentItemType[] = [
  "video",
  "article",
  "live_class",
  "test",
  "assignment",
  "external_import",
];

/**
 * data-model.md's per-type required-field table (research.md §3). Each type's payload shape is
 * validated here, in the application layer, never as a database CHECK — mirrors
 * `validateCustomFieldValues` (custom-fields/save-values.ts)'s precedent for "payload shape depends on
 * a type/config value looked up elsewhere."
 */
export function validateContentItemPayload(
  type: ContentItemType,
  payload: Record<string, unknown> | undefined,
): { error: string | null } {
  const p = payload ?? {};

  switch (type) {
    case "video":
      if (typeof p.url !== "string" || !p.url.trim()) {
        return { error: "payload.url is required for video content" };
      }
      return { error: null };
    case "article":
      if ((typeof p.body !== "string" || !p.body.trim()) && (typeof p.externalUrl !== "string" || !p.externalUrl.trim())) {
        return { error: "payload.body or payload.externalUrl is required for article content" };
      }
      return { error: null };
    case "live_class":
      if (typeof p.scheduledAt !== "string" || !p.scheduledAt.trim()) {
        return { error: "payload.scheduledAt is required for live_class content" };
      }
      return { error: null };
    case "test":
    case "assignment":
      return { error: null };
    case "external_import":
      if (typeof p.url !== "string" || !p.url.trim()) {
        return { error: "payload.url is required for external_import content" };
      }
      if (typeof p.sourceType !== "string" || !p.sourceType.trim()) {
        return { error: "payload.sourceType is required for external_import content" };
      }
      return { error: null };
    default:
      return { error: "Invalid type" };
  }
}
