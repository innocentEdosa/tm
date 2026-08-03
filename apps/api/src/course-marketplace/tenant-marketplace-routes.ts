import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requirePermission } from "../permissions/require-permission";
import { platformCourses, marketplaceSelections } from "../db/schema/platform-courses";
import { getPlatformCourseCurriculum } from "../platform-courses/platform-course-curriculum";
import { clonePlatformCourseIntoTenant } from "./clone-platform-course";

function toSummary(row: typeof platformCourses.$inferSelect, alreadySelected: boolean) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    categoryName: row.categoryName,
    deliveryMode: row.deliveryMode,
    duration: { value: Number(row.durationValue), unit: row.durationUnit },
    provider: row.provider,
    cost: row.cost === null ? null : Number(row.cost),
    alreadySelected,
  };
}

/** contracts/course-marketplace-api.md. Every route requires `requireTenantUserSession()` +
 * `requirePermission("course.manage")` (spec Clarifications — reused, no new permission key).
 * Platform-catalog reads go through `fastify.db` (no `tenant_id` to scope on those tables);
 * `marketplace_selections` reads/writes go through `request.tenantDb` (RLS-scoped to the caller's own
 * tenant) — `marketplace_selections` has `FORCE ROW LEVEL SECURITY` (0102_rls_marketplace_selections.sql),
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
      return { success: true, data: rows.map((r) => toSummary(r, selectedByCourse.has(r.id))) };
    },
  );

  // GET /tenant/course-marketplace/:platformCourseId — spec FR-006, contracts §GET detail.
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
      return {
        success: true,
        data: {
          ...toSummary(existing, selectedByCourse.has(existing.id)),
          selectionStatus: selectedByCourse.get(existing.id) ?? null,
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
