import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { marketplaceSelections } from "../db/schema/platform-courses";

/**
 * Originally spec 029's FR-013 immutability gate (a platform course froze entirely once any tenant
 * cloned it). Course Marketplace Updates (spec 032) removed that restriction — a platform course with
 * ≥1 fulfilled selection is now fully editable, same as one with zero. This predicate is kept and
 * reused for two narrower purposes instead: (1) `record-platform-course-change.ts` calls it
 * indirectly (via a `marketplace_selections` scan) to decide whether an edit needs to bump the
 * version/notify anyone; (2) `platform-course-file-routes.ts`/`platform-course-content-routes.ts`
 * call it directly to decide whether a file replace/delete must preserve the underlying R2 object
 * rather than delete it (research.md §3 of spec 032) — a tenant clone may still reference that object
 * by its `storage_key` until that tenant explicitly applies a future update.
 */
export async function platformCourseHasFulfilledSelection(db: Db, platformCourseId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: marketplaceSelections.id })
    .from(marketplaceSelections)
    .where(and(eq(marketplaceSelections.platformCourseId, platformCourseId), eq(marketplaceSelections.status, "fulfilled")))
    .limit(1);

  return row !== undefined;
}
