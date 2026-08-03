import { eq, and } from "drizzle-orm";
import type { Db } from "../db/client";
import { courses } from "../db/schema/courses";
import { courseModules, contentItems } from "../db/schema/course-content";
import { fileAttachments } from "../db/schema/file-attachments";
import {
  platformCourses,
  platformCourseModules,
  platformCourseContentItems,
  platformFileAttachments,
} from "../db/schema/platform-courses";
import { resolveOrCreateCourseCategory } from "../courses/course-category-resolution";

/**
 * Shared clone function (research.md §5) — the *only* place a platform course's metadata/curriculum
 * is copied into a tenant's own catalog. Used by both the free-course immediate-select path
 * (tenant-marketplace-routes.ts, called with `request.tenantDb`) and the paid-selection-resolution
 * path (admin-marketplace-selection-routes.ts, called with a `withTenantConnection`-scoped
 * connection) so the two paths can never silently diverge (spec FR-010, User Story 5).
 *
 * Clones `courses`/`course_modules`/`content_items` metadata rows, resolving the platform course's
 * plain `categoryName` into the target tenant's own category list via the existing
 * `resolveOrCreateCourseCategory` (spec 023). For each platform content item's `ready`
 * `platform_file_attachments` row, creates a new tenant `file_attachments` row referencing the
 * *same* `storage_key` — never re-uploads or duplicates the underlying R2 object (spec
 * Clarifications, SC-005). The cloned course starts `active` (not `draft`) since its platform source
 * was already published — a tenant selecting it expects it immediately usable, not a draft they must
 * separately publish.
 */
export async function clonePlatformCourseIntoTenant(
  tenantDb: Db,
  tenantId: string,
  platformCourseId: string,
  createdByUserId: string,
): Promise<string> {
  const [platformCourse] = await tenantDb.select().from(platformCourses).where(eq(platformCourses.id, platformCourseId));
  if (!platformCourse) {
    throw new Error(`Platform course ${platformCourseId} not found`);
  }

  const category = await resolveOrCreateCourseCategory(tenantDb, tenantId, platformCourse.categoryName, createdByUserId);

  const [newCourse] = await tenantDb
    .insert(courses)
    .values({
      tenantId,
      title: platformCourse.title,
      description: platformCourse.description,
      categoryId: category.id,
      deliveryMode: platformCourse.deliveryMode,
      durationValue: platformCourse.durationValue,
      durationUnit: platformCourse.durationUnit,
      provider: platformCourse.provider,
      cost: platformCourse.cost,
      status: "active",
      createdByUserId,
    })
    .returning();

  const platformModules = await tenantDb
    .select()
    .from(platformCourseModules)
    .where(eq(platformCourseModules.platformCourseId, platformCourseId))
    .orderBy(platformCourseModules.position);

  const moduleIdMap = new Map<string, string>();
  const outlineOrder: string[] = [];
  for (const pm of platformModules) {
    const [newModule] = await tenantDb
      .insert(courseModules)
      .values({
        tenantId,
        courseId: newCourse.id,
        title: pm.title,
        description: pm.description,
        position: pm.position,
        // Published, not the schema default "draft" — same reasoning as the course itself starting
        // "active" above: the platform source was already published, so the clone must be
        // immediately usable, not something the tenant has to separately publish module-by-module.
        status: "published",
        createdByUserId,
      })
      .returning();
    moduleIdMap.set(pm.id, newModule.id);
    outlineOrder.push(newModule.id);
  }
  // `courses.outlineOrder` (module ids + standalone content-item ids, spec 028) drives what
  // `GET .../curriculum` renders — every other module-creation path appends to it, and platform
  // content items are always module-scoped (never standalone), so only module ids belong here.
  // Skipping this left every cloned course's outline empty — modules/content items existed in the
  // DB but the editor rendered "No modules or lessons yet" (found in production use, spec 029
  // follow-up).
  if (outlineOrder.length > 0) {
    await tenantDb.update(courses).set({ outlineOrder }).where(eq(courses.id, newCourse.id));
  }

  const platformItems = await tenantDb
    .select()
    .from(platformCourseContentItems)
    .where(eq(platformCourseContentItems.platformCourseId, platformCourseId))
    .orderBy(platformCourseContentItems.position);

  for (const pi of platformItems) {
    const newModuleId = moduleIdMap.get(pi.platformCourseModuleId);
    if (!newModuleId) continue;

    const [newItem] = await tenantDb
      .insert(contentItems)
      .values({
        tenantId,
        courseId: newCourse.id,
        moduleId: newModuleId,
        type: pi.type,
        title: pi.title,
        description: pi.description,
        payload: pi.payload,
        position: pi.position,
        // Published, not the schema default "draft" — see the matching module-status comment above.
        status: "published",
        createdByUserId,
      })
      .returning();

    const attachments = await tenantDb
      .select()
      .from(platformFileAttachments)
      .where(
        and(
          eq(platformFileAttachments.entityType, "platform_content_item"),
          eq(platformFileAttachments.entityId, pi.id),
          eq(platformFileAttachments.status, "ready"),
        ),
      );

    for (const attachment of attachments) {
      await tenantDb.insert(fileAttachments).values({
        tenantId,
        entityType: "content_item",
        entityId: newItem.id,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
        storageKey: attachment.storageKey,
        status: "ready",
        createdByUserId,
      });
    }
  }

  return newCourse.id;
}
