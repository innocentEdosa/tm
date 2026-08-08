import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { requireSuperAdminSession } from "../platform-auth/require-super-admin-session";
import { marketplaceSelections, platformCourses } from "../db/schema/platform-courses";
import { tenants } from "../db/schema/tenants";
import { users } from "../db/schema/users";
import { withTenantConnection } from "../db/with-tenant-connection";
import { clonePlatformCourseIntoTenant } from "./clone-platform-course";

interface ResolveBody {
  decision?: "paid" | "rejected";
}

/** contracts/platform-course-authoring-api.md §marketplace-selections. List reads via
 * `request.superAdminDb` (research.md §3 — `super_admin_full_access` policy, cross-tenant). Resolve
 * runs the shared clone function (research.md §5) against a `withTenantConnection`-scoped connection
 * for the `paid` decision — never `request.superAdminDb`, which is pinned to the nil UUID and cannot
 * satisfy `tenant_isolation`'s `WITH CHECK` on a real tenant's rows (research.md §4). */
const adminMarketplaceSelectionRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /admin/marketplace-selections — spec FR-011, contracts §GET. Extended (UI-reuse follow-up)
  // with an optional `platformCourseId` filter and a `status=all` escape hatch — both needed by the
  // Performance/adoption panel on a platform course's editor ("how many tenants have selected this
  // course, in what status"), which is a different read shape than the default cross-tenant pending
  // queue (defaults to `requested` only, across every platform course) but reuses the same query.
  fastify.get<{ Querystring: { status?: string; platformCourseId?: string } }>(
    "/admin/marketplace-selections",
    { preHandler: [requireSuperAdminSession] },
    async (request) => {
      const status = request.query.status ?? "requested";
      const conditions = [];
      if (status !== "all") {
        conditions.push(eq(marketplaceSelections.status, status));
      }
      if (request.query.platformCourseId) {
        conditions.push(eq(marketplaceSelections.platformCourseId, request.query.platformCourseId));
      }

      const rows = await request.superAdminDb!
        .select({
          id: marketplaceSelections.id,
          tenantId: marketplaceSelections.tenantId,
          tenantName: tenants.name,
          platformCourseId: marketplaceSelections.platformCourseId,
          platformCourseTitle: platformCourses.title,
          status: marketplaceSelections.status,
          requestedByUserId: marketplaceSelections.requestedByUserId,
          requestedByName: users.fullName,
          requestedAt: marketplaceSelections.requestedAt,
          resolvedAt: marketplaceSelections.resolvedAt,
          clonedCourseId: marketplaceSelections.clonedCourseId,
        })
        .from(marketplaceSelections)
        .innerJoin(tenants, eq(tenants.id, marketplaceSelections.tenantId))
        .innerJoin(platformCourses, eq(platformCourses.id, marketplaceSelections.platformCourseId))
        .innerJoin(users, eq(users.id, marketplaceSelections.requestedByUserId))
        .where(and(...conditions))
        .orderBy(desc(marketplaceSelections.requestedAt));

      return { success: true, data: rows };
    },
  );

  // POST /admin/marketplace-selections/:id/resolve — spec FR-011/FR-012, contracts §POST resolve.
  fastify.post<{ Params: { id: string }; Body: ResolveBody }>(
    "/admin/marketplace-selections/:id/resolve",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const { id } = request.params;
      const decision = request.body?.decision;
      if (decision !== "paid" && decision !== "rejected") {
        return reply.code(400).send({ success: false, message: "decision must be 'paid' or 'rejected'" });
      }

      const [selection] = await request.superAdminDb!.select().from(marketplaceSelections).where(eq(marketplaceSelections.id, id));
      if (!selection || selection.status !== "requested") {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      if (decision === "rejected") {
        const [updated] = await request.superAdminDb!
          .update(marketplaceSelections)
          .set({ status: "rejected", resolvedBySuperAdminId: request.superAdmin!.id, resolvedAt: new Date(), updatedAt: new Date() })
          .where(eq(marketplaceSelections.id, id))
          .returning();
        return reply.code(200).send({ success: true, data: updated });
      }

      const courseId = await withTenantConnection(fastify.pg.pool, selection.tenantId, (tenantDb) =>
        clonePlatformCourseIntoTenant(tenantDb, selection.tenantId, selection.platformCourseId, selection.requestedByUserId),
      );

      // Course Marketplace Updates (spec 032) — the platform course's version *at the moment of this
      // clone*, same reasoning as the free-course immediate-select path (tenant-marketplace-routes.ts).
      const [platformCourse] = await fastify.db.select({ version: platformCourses.version }).from(platformCourses).where(eq(platformCourses.id, selection.platformCourseId));

      const [updated] = await request.superAdminDb!
        .update(marketplaceSelections)
        .set({
          status: "fulfilled",
          clonedCourseId: courseId,
          resolvedBySuperAdminId: request.superAdmin!.id,
          resolvedAt: new Date(),
          updatedAt: new Date(),
          appliedPlatformCourseVersion: platformCourse?.version ?? 1,
        })
        .where(eq(marketplaceSelections.id, id))
        .returning();

      return reply.code(200).send({ success: true, data: updated });
    },
  );
};

export default adminMarketplaceSelectionRoutes;
