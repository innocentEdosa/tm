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
  marketplaceSelections,
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
 * `platform_file_attachments` row (`kind:"file"` or `kind:"link"` alike), and for the platform
 * course's own image if it has one, creates a new tenant `file_attachments` row referencing the
 * *same* `storage_key` for a `file` row — never re-uploads or duplicates the underlying R2 object
 * (spec Clarifications, SC-005) — or copying the `url` directly for a `link` row (nothing to share,
 * it was never in R2 to begin with). The cloned course starts `active` (not `draft`) since its
 * platform source was already published — a tenant selecting it expects it immediately usable, not
 * a draft they must separately publish.
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

  const [courseImage] = await tenantDb
    .select()
    .from(platformFileAttachments)
    .where(
      and(
        eq(platformFileAttachments.entityType, "platform_course"),
        eq(platformFileAttachments.entityId, platformCourseId),
        eq(platformFileAttachments.status, "ready"),
      ),
    );
  if (courseImage) {
    await tenantDb.insert(fileAttachments).values({
      tenantId,
      entityType: "course",
      entityId: newCourse.id,
      kind: "file",
      fileName: courseImage.fileName,
      contentType: courseImage.contentType,
      sizeBytes: courseImage.sizeBytes,
      storageKey: courseImage.storageKey,
      status: "ready",
      createdByUserId,
    });
  }

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
        // Course Marketplace Updates (spec 032) — records which platform module this tenant module
        // came from, so a future applyPlatformCourseUpdateToTenant can match and update this exact
        // row in place instead of re-inserting it (research.md §4).
        sourcePlatformCourseModuleId: pm.id,
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
        // Course Marketplace Updates (spec 032) — same purpose as courseModules'
        // sourcePlatformCourseModuleId above, one level down (research.md §4).
        sourcePlatformCourseContentItemId: pi.id,
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
        kind: attachment.kind,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
        storageKey: attachment.storageKey,
        url: attachment.url,
        status: "ready",
        createdByUserId,
      });
    }
  }

  return newCourse.id;
}

/**
 * Course Marketplace Updates (spec 032) — brings an already-cloned tenant course up to date with its
 * platform source's *current* content, in place, without touching `learner_content_progress`
 * (FR-007, research.md §4). Reuses the same category-resolution and shared-storage-reference approach
 * as `clonePlatformCourseIntoTenant` above, but reconciles rather than only inserts:
 *
 * - The tenant `courses` row's metadata is updated in place (same row id) — `status` is left alone,
 *   since that's the tenant's own workflow state, not part of the platform's published content.
 * - Modules/content-items are matched to their platform counterpart via `sourcePlatformCourseModuleId`/
 *   `sourcePlatformCourseContentItemId` (set by this same function, and by `clonePlatformCourseIntoTenant`
 *   above, on every row that came from the platform): a match is updated in place (same row id, so any
 *   `learner_content_progress` referencing it keeps resolving); a platform item with no existing match
 *   is inserted (clone-style); a tenant row whose source no longer appears among the platform's current
 *   modules/items is deleted. A module delete's own content items are cleaned up explicitly first (no
 *   DB-level FK on `file_attachments`, and cascading through the module-delete FK alone would skip that
 *   cleanup) — mirrors the same "attachments before delete" convention as every other module/content-item
 *   delete route in this codebase.
 * - A tenant-authored module or content item (never came from the platform — `source...Id IS NULL`) is
 *   never touched, updated, or deleted by this function; it is entirely the tenant's own content living
 *   alongside the reconciled platform content.
 * - File attachments on a *matched* content item are fully replaced (old rows deleted, new rows
 *   inserted referencing the platform's current `ready` attachments) rather than diffed one-by-one —
 *   proportional given a content item typically has very few attachments, and simpler than tracking a
 *   third level of stable ids.
 * - Never calls `storage.deleteObject` anywhere in this function — every object referenced by a
 *   platform attachment (past or present) is platform-owned/shared (research.md §3); only this
 *   tenant's own `file_attachments`/`course_modules`/`content_items` *rows* are ever deleted here.
 */
export async function applyPlatformCourseUpdateToTenant(
  tenantDb: Db,
  tenantId: string,
  courseId: string,
  platformCourseId: string,
  selectionId: string,
  userId: string,
): Promise<void> {
  const [platformCourse] = await tenantDb.select().from(platformCourses).where(eq(platformCourses.id, platformCourseId));
  if (!platformCourse) {
    throw new Error(`Platform course ${platformCourseId} not found`);
  }

  const category = await resolveOrCreateCourseCategory(tenantDb, tenantId, platformCourse.categoryName, userId);

  await tenantDb
    .update(courses)
    .set({
      title: platformCourse.title,
      description: platformCourse.description,
      categoryId: category.id,
      deliveryMode: platformCourse.deliveryMode,
      durationValue: platformCourse.durationValue,
      durationUnit: platformCourse.durationUnit,
      provider: platformCourse.provider,
      cost: platformCourse.cost,
      updatedByUserId: userId,
      updatedAt: new Date(),
    })
    .where(eq(courses.id, courseId));

  // Course image — row swap only (never touches R2), same reasoning as the file-reconciliation note
  // above.
  const [platformImage] = await tenantDb
    .select()
    .from(platformFileAttachments)
    .where(and(eq(platformFileAttachments.entityType, "platform_course"), eq(platformFileAttachments.entityId, platformCourseId), eq(platformFileAttachments.status, "ready")));
  const [tenantImage] = await tenantDb.select().from(fileAttachments).where(and(eq(fileAttachments.entityType, "course"), eq(fileAttachments.entityId, courseId)));
  if (platformImage?.storageKey !== tenantImage?.storageKey) {
    if (tenantImage) {
      await tenantDb.delete(fileAttachments).where(eq(fileAttachments.id, tenantImage.id));
    }
    if (platformImage) {
      await tenantDb.insert(fileAttachments).values({
        tenantId,
        entityType: "course",
        entityId: courseId,
        kind: "file",
        fileName: platformImage.fileName,
        contentType: platformImage.contentType,
        sizeBytes: platformImage.sizeBytes,
        storageKey: platformImage.storageKey,
        status: "ready",
        createdByUserId: userId,
      });
    }
  }

  const platformModules = await tenantDb
    .select()
    .from(platformCourseModules)
    .where(eq(platformCourseModules.platformCourseId, platformCourseId))
    .orderBy(platformCourseModules.position);
  const platformModuleIds = new Set(platformModules.map((m) => m.id));

  const existingTenantModules = await tenantDb.select().from(courseModules).where(eq(courseModules.courseId, courseId));
  const tenantModuleBySourceId = new Map(
    existingTenantModules.filter((m) => m.sourcePlatformCourseModuleId).map((m) => [m.sourcePlatformCourseModuleId!, m]),
  );

  // Modules that came from the platform but no longer exist there — remove them (and, first, their
  // content items' attachment rows + the content items themselves, since a module delete has no
  // cascading cleanup for the polymorphic, FK-less file_attachments table).
  for (const tenantModule of existingTenantModules) {
    if (!tenantModule.sourcePlatformCourseModuleId || platformModuleIds.has(tenantModule.sourcePlatformCourseModuleId)) continue;
    const orphanedItems = await tenantDb.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.moduleId, tenantModule.id));
    for (const item of orphanedItems) {
      await tenantDb.delete(fileAttachments).where(and(eq(fileAttachments.entityType, "content_item"), eq(fileAttachments.entityId, item.id)));
    }
    await tenantDb.delete(contentItems).where(eq(contentItems.moduleId, tenantModule.id));
    await tenantDb.delete(courseModules).where(eq(courseModules.id, tenantModule.id));
  }

  const moduleIdMap = new Map<string, string>();
  for (const pm of platformModules) {
    const existingTenantModule = tenantModuleBySourceId.get(pm.id);
    if (existingTenantModule) {
      await tenantDb
        .update(courseModules)
        .set({ title: pm.title, description: pm.description, position: pm.position, updatedByUserId: userId, updatedAt: new Date() })
        .where(eq(courseModules.id, existingTenantModule.id));
      moduleIdMap.set(pm.id, existingTenantModule.id);
    } else {
      const [newModule] = await tenantDb
        .insert(courseModules)
        .values({
          tenantId,
          courseId,
          title: pm.title,
          description: pm.description,
          position: pm.position,
          status: "published",
          sourcePlatformCourseModuleId: pm.id,
          createdByUserId: userId,
        })
        .returning();
      moduleIdMap.set(pm.id, newModule.id);
    }
  }

  // Rebuild the outline: reconciled platform modules first (in the platform's order), then any
  // pre-existing tenant-authored top-level entries (modules or standalone content items with no
  // platform source) appended after, in their prior relative order. This keeps platform-derived
  // content correctly ordered among itself; a tenant-added module may move to the end of the outline
  // relative to reconciled platform modules rather than staying interleaved at its original position —
  // flagged as a reasonable, minor simplification (FR-007 only requires the platform's structure be
  // reflected, not that a tenant's own additions keep their exact prior interleaving).
  const [courseRow] = await tenantDb.select({ outlineOrder: courses.outlineOrder }).from(courses).where(eq(courses.id, courseId));
  const platformDerivedModuleIds = new Set(moduleIdMap.values());
  const tenantOnlyOutlineEntries = (courseRow?.outlineOrder ?? []).filter(
    (id) => !existingTenantModules.some((m) => m.sourcePlatformCourseModuleId && m.id === id) && !platformDerivedModuleIds.has(id),
  );
  const outlineOrder = [...platformModules.map((pm) => moduleIdMap.get(pm.id)!), ...tenantOnlyOutlineEntries];
  await tenantDb.update(courses).set({ outlineOrder }).where(eq(courses.id, courseId));

  const platformItems = await tenantDb
    .select()
    .from(platformCourseContentItems)
    .where(eq(platformCourseContentItems.platformCourseId, platformCourseId))
    .orderBy(platformCourseContentItems.position);
  const platformItemIds = new Set(platformItems.map((i) => i.id));

  // Content items belonging to a module this apply just reconciled (kept or newly inserted) — a
  // module-less standalone tenant item is out of scope for platform reconciliation (platform content
  // items are always module-scoped, per clonePlatformCourseIntoTenant's own doc comment).
  const reconciledTenantModuleIds = new Set(moduleIdMap.values());
  const allTenantItems = await tenantDb.select().from(contentItems).where(eq(contentItems.courseId, courseId));
  const relevantTenantItems = allTenantItems.filter((i) => i.moduleId && reconciledTenantModuleIds.has(i.moduleId));
  const tenantItemBySourceId = new Map(
    relevantTenantItems.filter((i) => i.sourcePlatformCourseContentItemId).map((i) => [i.sourcePlatformCourseContentItemId!, i]),
  );

  for (const tenantItem of relevantTenantItems) {
    if (!tenantItem.sourcePlatformCourseContentItemId || platformItemIds.has(tenantItem.sourcePlatformCourseContentItemId)) continue;
    await tenantDb.delete(fileAttachments).where(and(eq(fileAttachments.entityType, "content_item"), eq(fileAttachments.entityId, tenantItem.id)));
    await tenantDb.delete(contentItems).where(eq(contentItems.id, tenantItem.id));
  }

  for (const pi of platformItems) {
    const tenantModuleId = moduleIdMap.get(pi.platformCourseModuleId);
    if (!tenantModuleId) continue;

    const platformAttachments = await tenantDb
      .select()
      .from(platformFileAttachments)
      .where(and(eq(platformFileAttachments.entityType, "platform_content_item"), eq(platformFileAttachments.entityId, pi.id), eq(platformFileAttachments.status, "ready")));

    const existingTenantItem = tenantItemBySourceId.get(pi.id);
    let tenantItemId: string;
    if (existingTenantItem) {
      await tenantDb
        .update(contentItems)
        .set({
          title: pi.title,
          description: pi.description,
          payload: pi.payload,
          position: pi.position,
          moduleId: tenantModuleId,
          updatedByUserId: userId,
          updatedAt: new Date(),
        })
        .where(eq(contentItems.id, existingTenantItem.id));
      tenantItemId = existingTenantItem.id;
      await tenantDb.delete(fileAttachments).where(and(eq(fileAttachments.entityType, "content_item"), eq(fileAttachments.entityId, tenantItemId)));
    } else {
      const [newItem] = await tenantDb
        .insert(contentItems)
        .values({
          tenantId,
          courseId,
          moduleId: tenantModuleId,
          type: pi.type,
          title: pi.title,
          description: pi.description,
          payload: pi.payload,
          position: pi.position,
          status: "published",
          sourcePlatformCourseContentItemId: pi.id,
          createdByUserId: userId,
        })
        .returning();
      tenantItemId = newItem.id;
    }

    for (const attachment of platformAttachments) {
      await tenantDb.insert(fileAttachments).values({
        tenantId,
        entityType: "content_item",
        entityId: tenantItemId,
        kind: attachment.kind,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
        storageKey: attachment.storageKey,
        url: attachment.url,
        status: "ready",
        createdByUserId: userId,
      });
    }
  }

  await tenantDb
    .update(marketplaceSelections)
    .set({ appliedPlatformCourseVersion: platformCourse.version, updatedAt: new Date() })
    .where(eq(marketplaceSelections.id, selectionId));
}
