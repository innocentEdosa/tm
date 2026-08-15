import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { courses } from "../db/schema/courses";

/**
 * Course Content Draft-Reversion — editing a published course's content shouldn't silently go live
 * with the change; the admin decides when new content is visible, same principle as the
 * course-creation wizard's own explicit "Publish Course" step. Every content-mutating path (module/
 * lesson create/update/reorder/delete, course details/objectives, course/lesson images and resources)
 * calls this after writing, flipping an `active` course back to `draft` so the admin has to explicitly
 * republish. Deliberately narrow: only `active` → `draft`; a `draft` course is already a no-op, and an
 * `archived` one is left alone (un-archiving is not a side effect any edit should ever cause).
 *
 * Lives in its own module (not `course-service.ts`, which already imports `deleteAllAttachmentsForEntity`
 * FROM `attachments/tenant-attachment-routes.ts`) specifically so that file can import this helper back
 * without the two forming a circular module dependency.
 */
export async function revertToDraftIfPublished(db: Db, courseId: string): Promise<void> {
  await db.update(courses).set({ status: "draft" }).where(and(eq(courses.id, courseId), eq(courses.status, "active")));
}
