import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requirePermission } from "../permissions/require-permission";
import { platformCourses, marketplaceSelections, platformFileAttachments } from "../db/schema/platform-courses";
import { courses } from "../db/schema/courses";
import { getPlatformCourseCurriculum } from "../platform-courses/platform-course-curriculum";
import { clonePlatformCourseIntoTenant, applyPlatformCourseUpdateToTenant } from "./clone-platform-course";
import { toResponseRows as toCourseResponseRows } from "../courses/tenant-course-routes";
import * as storage from "../storage/storage";

function toSummary(row: typeof platformCourses.$inferSelect, alreadySelected: boolean, courseImageUrl: string | null) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    categoryName: row.categoryName,
    deliveryMode: row.deliveryMode,
    duration: { value: Number(row.durationValue), unit: row.durationUnit },
    provider: row.provider,
    cost: row.cost === null ? null : Number(row.cost),
    courseImageUrl,
    alreadySelected,
  };
}

/** Batch version of the single-course image lookup below — the browse-list route needs one
 * presigned URL per card without an N+1 round trip per course, same batching shape as
 * `platform-course-routes.ts`'s own `toResponseRows` (Super Admin course list). */
async function batchResolveCourseImageUrls(db: Db, platformCourseIds: string[]): Promise<Map<string, string>> {
  const urlByCourseId = new Map<string, string>();
  if (platformCourseIds.length === 0 || !storage.isStorageConfigured()) return urlByCourseId;

  const rows = await db
    .select({ entityId: platformFileAttachments.entityId, storageKey: platformFileAttachments.storageKey, createdAt: platformFileAttachments.createdAt })
    .from(platformFileAttachments)
    .where(
      and(
        eq(platformFileAttachments.entityType, "platform_course"),
        inArray(platformFileAttachments.entityId, platformCourseIds),
        eq(platformFileAttachments.status, "ready"),
      ),
    )
    .orderBy(desc(platformFileAttachments.createdAt));

  const latestKeyByCourseId = new Map<string, string>();
  for (const row of rows) {
    if (!latestKeyByCourseId.has(row.entityId) && row.storageKey) {
      latestKeyByCourseId.set(row.entityId, row.storageKey);
    }
  }
  await Promise.all(
    Array.from(latestKeyByCourseId.entries()).map(async ([courseId, key]) => {
      urlByCourseId.set(courseId, await storage.createPresignedDownloadUrl(key));
    }),
  );
  return urlByCourseId;
}

/** contracts/course-marketplace-api.md. Every route requires `requireTenantUserSession()` +
 * `requirePermission("course.manage")` (spec Clarifications — reused, no new permission key).
 * Platform-catalog reads go through `fastify.db` (no `tenant_id` to scope on those tables);
 * `marketplace_selections` reads/writes go through `request.tenantDb` (RLS-scoped to the caller's own
 * tenant) — `marketplace_selections` has `FORCE ROW LEVEL SECURITY` (0103_rls_marketplace_selections.sql),
 * so a `fastify.db` query here would silently return zero rows (no `app.tenant_id` GUC set on that
 * pool), the same class of bug T038 already found and fixed for the immutability guard. */
const tenantMarketplaceRoutes: FastifyPluginAsync = async (fastify) => {
  async function activeSelectionsByPlatformCourse(tenantDb: Db, tenantId: string) {
    const rows = await tenantDb
      .select({ platformCourseId: marketplaceSelections.platformCourseId, status: marketplaceSelections.status })
      .from(marketplaceSelections)
      .where(and(eq(marketplaceSelections.tenantId, tenantId), ne(marketplaceSelections.status, "rejected")));
    return new Map(rows.map((r) => [r.platformCourseId, r.status]));
  }

  // GET /tenant/course-marketplace — spec FR-006, contracts §GET list.
  fastify.get<{
    Querystring: { search?: string; category?: string; deliveryMode?: string; cost?: "free" | "paid" };
  }>(
    "/tenant/course-marketplace",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request) => {
      const conditions = [eq(platformCourses.status, "active")];
      if (request.query.category) {
        conditions.push(eq(platformCourses.categoryName, request.query.category));
      }
      if (request.query.deliveryMode) {
        conditions.push(eq(platformCourses.deliveryMode, request.query.deliveryMode));
      }
      if (request.query.search) {
        conditions.push(sql`${platformCourses.title} ILIKE ${`%${request.query.search}%`}`);
      }
      if (request.query.cost === "free") {
        conditions.push(sql`(${platformCourses.cost} is null or ${platformCourses.cost} = 0)`);
      } else if (request.query.cost === "paid") {
        conditions.push(sql`${platformCourses.cost} > 0`);
      }

      const rows = await fastify.db
        .select()
        .from(platformCourses)
        .where(and(...conditions))
        .orderBy(desc(platformCourses.createdAt));

      const selectedByCourse = await activeSelectionsByPlatformCourse(request.tenantDb, request.user!.tenantId);
      const imageUrlByCourse = await batchResolveCourseImageUrls(fastify.db, rows.map((r) => r.id));
      return {
        success: true,
        data: rows.map((r) => toSummary(r, selectedByCourse.has(r.id), imageUrlByCourse.get(r.id) ?? null)),
      };
    },
  );

  // GET /tenant/course-marketplace/:platformCourseId — spec FR-006, contracts §GET detail. Full
  // detail (spec 032 follow-up: full-screen course preview page) also surfaces courseImageUrl,
  // learningObjectives, and requirements — none of which the browse-list summary needs.
  fastify.get<{ Params: { platformCourseId: string } }>(
    "/tenant/course-marketplace/:platformCourseId",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const [existing] = await fastify.db.select().from(platformCourses).where(eq(platformCourses.id, request.params.platformCourseId));
      if (!existing || existing.status !== "active") {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const selectedByCourse = await activeSelectionsByPlatformCourse(request.tenantDb, request.user!.tenantId);
      const curriculum = await getPlatformCourseCurriculum(fastify.db, existing.id);

      const [image] = await fastify.db
        .select({ storageKey: platformFileAttachments.storageKey })
        .from(platformFileAttachments)
        .where(
          and(
            eq(platformFileAttachments.entityType, "platform_course"),
            eq(platformFileAttachments.entityId, existing.id),
            eq(platformFileAttachments.status, "ready"),
          ),
        )
        .orderBy(desc(platformFileAttachments.createdAt))
        .limit(1);
      const courseImageUrl = image?.storageKey && storage.isStorageConfigured() ? await storage.createPresignedDownloadUrl(image.storageKey) : null;

      return {
        success: true,
        data: {
          ...toSummary(existing, selectedByCourse.has(existing.id), courseImageUrl),
          selectionStatus: selectedByCourse.get(existing.id) ?? null,
          learningObjectives: existing.learningObjectives,
          requirements: existing.requirements,
          modules: curriculum,
        },
      };
    },
  );

  // POST /tenant/course-marketplace/:platformCourseId/select — spec FR-008/FR-009, contracts §POST select.
  fastify.post<{ Params: { platformCourseId: string } }>(
    "/tenant/course-marketplace/:platformCourseId/select",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { platformCourseId } = request.params;
      const [platformCourse] = await fastify.db.select().from(platformCourses).where(eq(platformCourses.id, platformCourseId));
      if (!platformCourse || platformCourse.status !== "active") {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const tenantId = request.user!.tenantId;
      const isFree = platformCourse.cost === null || Number(platformCourse.cost) === 0;

      try {
        if (isFree) {
          const courseId = await clonePlatformCourseIntoTenant(request.tenantDb, tenantId, platformCourseId, request.user!.id);
          await request.tenantDb.insert(marketplaceSelections).values({
            tenantId,
            platformCourseId,
            status: "fulfilled",
            clonedCourseId: courseId,
            requestedByUserId: request.user!.id,
            resolvedAt: new Date(),
            // Course Marketplace Updates (spec 032) — the platform course's version *at the moment of
            // this clone*, not the column default of 1: if it had already been edited before this
            // tenant ever selected it, the clone already reflects that content, so it must start
            // "caught up," not immediately flagged as having an update available.
            appliedPlatformCourseVersion: platformCourse.version,
          });
          return reply.code(201).send({ success: true, data: { outcome: "cloned", courseId } });
        }

        const [selection] = await request.tenantDb
          .insert(marketplaceSelections)
          .values({ tenantId, platformCourseId, status: "requested", requestedByUserId: request.user!.id })
          .returning();
        return reply.code(201).send({ success: true, data: { outcome: "requested", selectionId: selection.id } });
      } catch (err) {
        if ((err as { cause?: { code?: string } })?.cause?.code === "23505") {
          return reply.code(409).send({ success: false, message: "This platform course has already been selected" });
        }
        throw err;
      }
    },
  );

  /** Shared by apply/dismiss below — resolves the caller's tenant's `fulfilled` selection for a
   * given tenant course id, joined to its platform course's current `version` (contracts
   * §apply/§dismiss). Returns `null` if the course doesn't exist, isn't a marketplace clone for this
   * tenant, or has no `fulfilled` selection. */
  async function resolveFulfilledSelection(tenantDb: Db, tenantId: string, courseId: string) {
    const [row] = await tenantDb
      .select({ selection: marketplaceSelections, platformCourseVersion: platformCourses.version })
      .from(marketplaceSelections)
      .innerJoin(platformCourses, eq(platformCourses.id, marketplaceSelections.platformCourseId))
      .where(
        and(
          eq(marketplaceSelections.tenantId, tenantId),
          eq(marketplaceSelections.clonedCourseId, courseId),
          eq(marketplaceSelections.status, "fulfilled"),
        ),
      );
    return row ?? null;
  }

  // POST /tenant/courses/:courseId/marketplace-update/apply — spec FR-007, contracts §apply.
  fastify.post<{ Params: { courseId: string } }>(
    "/tenant/courses/:courseId/marketplace-update/apply",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { courseId } = request.params;
      const tenantId = request.user!.tenantId;
      const found = await resolveFulfilledSelection(request.tenantDb, tenantId, courseId);
      if (!found) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (found.platformCourseVersion <= found.selection.appliedPlatformCourseVersion) {
        return reply.code(422).send({ success: false, message: "No update is available for this course" });
      }

      await applyPlatformCourseUpdateToTenant(
        request.tenantDb,
        tenantId,
        courseId,
        found.selection.platformCourseId,
        found.selection.id,
        request.user!.id,
      );

      const [courseRow] = await request.tenantDb.select().from(courses).where(eq(courses.id, courseId));
      const [data] = await toCourseResponseRows(request.tenantDb, [courseRow]);
      return reply.code(200).send({ success: true, data });
    },
  );

  // POST /tenant/courses/:courseId/marketplace-update/dismiss — spec FR-008, contracts §dismiss.
  fastify.post<{ Params: { courseId: string } }>(
    "/tenant/courses/:courseId/marketplace-update/dismiss",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { courseId } = request.params;
      const tenantId = request.user!.tenantId;
      const found = await resolveFulfilledSelection(request.tenantDb, tenantId, courseId);
      if (!found) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      const updateAvailable =
        found.platformCourseVersion > found.selection.appliedPlatformCourseVersion &&
        found.selection.dismissedPlatformCourseVersion !== found.platformCourseVersion;
      if (!updateAvailable) {
        return reply.code(422).send({ success: false, message: "No update is available to dismiss for this course" });
      }

      await request.tenantDb
        .update(marketplaceSelections)
        .set({ dismissedPlatformCourseVersion: found.platformCourseVersion, updatedAt: new Date() })
        .where(eq(marketplaceSelections.id, found.selection.id));

      const [courseRow] = await request.tenantDb.select().from(courses).where(eq(courses.id, courseId));
      const [data] = await toCourseResponseRows(request.tenantDb, [courseRow]);
      return reply.code(200).send({ success: true, data });
    },
  );

  // GET /tenant/course-marketplace/selections — spec US5, contracts §GET selections.
  fastify.get(
    "/tenant/course-marketplace/selections",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request) => {
      const rows = await request.tenantDb
        .select()
        .from(marketplaceSelections)
        .where(eq(marketplaceSelections.tenantId, request.user!.tenantId))
        .orderBy(desc(marketplaceSelections.requestedAt));
      return { success: true, data: rows };
    },
  );
};

export default tenantMarketplaceRoutes;
