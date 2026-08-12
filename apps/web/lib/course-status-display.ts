import type { ContentStatus } from "./course-api-types";

/**
 * The single canonical draft/published/archived → label/dot-color/badge-variant mapping for
 * `CourseModule`/`ContentItem` (AI Course Experience — UI Consistency phase). Extracted out of
 * `curriculum-tab.tsx` — its previous sole location — so it's directly unit-testable without a
 * component-rendering setup, and so a future consumer reuses this instead of a second, possibly
 * drifting, copy. `archived` gets its own distinct dot/variant, not shared with `draft`'s `neutral`
 * — otherwise an archived module/lesson would be visually indistinguishable from a draft one at a
 * glance, exactly the "treated as draft" failure mode this phase exists to fix.
 */
export const CONTENT_STATUS_LABEL: Record<ContentStatus, string> = { draft: "Draft", published: "Published", archived: "Archived" };
export const CONTENT_STATUS_DOT: Record<ContentStatus, string> = { draft: "bg-slate-400", published: "bg-green-600", archived: "bg-amber-500" };
export const CONTENT_STATUS_BADGE_VARIANT: Record<ContentStatus, "success" | "neutral" | "accent"> = { draft: "neutral", published: "success", archived: "accent" };
