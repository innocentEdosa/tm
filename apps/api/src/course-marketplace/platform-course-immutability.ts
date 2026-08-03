import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { marketplaceSelections } from "../db/schema/platform-courses";

/**
 * FR-013 / data-model.md's immutability rule: a platform course's content (modules, content items,
 * attached files) — and, per spec 029 tasks.md T038, its immutable metadata fields
 * (title/categoryName/deliveryMode/duration) — becomes frozen once at least one tenant has a
 * `fulfilled` selection referencing it, so a tenant's already-cloned copy never changes underneath it
 * (spec Clarifications). A platform course with zero `fulfilled` selections remains fully editable.
 */
export async function platformCourseHasFulfilledSelection(db: Db, platformCourseId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: marketplaceSelections.id })
    .from(marketplaceSelections)
    .where(and(eq(marketplaceSelections.platformCourseId, platformCourseId), eq(marketplaceSelections.status, "fulfilled")))
    .limit(1);

  return row !== undefined;
}
