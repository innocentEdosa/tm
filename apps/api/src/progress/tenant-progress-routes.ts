import type { FastifyPluginAsync } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requireAnyPermission } from "../permissions/require-permission";
import { courses } from "../db/schema/courses";
import { courseModules, contentItems } from "../db/schema/course-content";
import { learnerContentProgress } from "../db/schema/learner-content-progress";
import { users } from "../db/schema/users";
import { validateProgressUpdate, type ProgressUpdateBody } from "./progress-validation";

type ProgressRow = typeof learnerContentProgress.$inferSelect;

/** contracts/learner-progress-api.md. All routes operate through `request.tenantDb` (RLS-scoped) — no
 * route ever takes or trusts a client-supplied tenant id, and no route ever accepts a client-supplied
 * `userId` — "self" is always `request.user!.id` (research.md §3/§4). */
const tenantProgressRoutes: FastifyPluginAsync = async (fastify) => {
  function toResponseRow(row: ProgressRow) {
    return {
      contentItemId: row.contentItemId,
      status: row.status,
      scoreRaw: row.scoreRaw,
      scoreMin: row.scoreMin,
      scoreMax: row.scoreMax,
      bookmark: row.bookmark,
      suspendData: row.suspendData,
      totalTimeSeconds: row.totalTimeSeconds,
      enteredAt: row.enteredAt,
      exitedAt: row.exitedAt,
      updatedAt: row.updatedAt,
    };
  }

  function notStartedRow(contentItemId: string) {
    return {
      contentItemId,
      status: "not_started",
      scoreRaw: null,
      scoreMin: null,
      scoreMax: null,
      bookmark: null,
      suspendData: null,
      totalTimeSeconds: 0,
      enteredAt: null,
      exitedAt: null,
      updatedAt: null,
    };
  }

  async function resolveContentItem(tenantDb: typeof fastify.db, contentItemId: string) {
    const [item] = await tenantDb.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.id, contentItemId));
    return item ?? null;
  }

  async function resolveCourse(tenantDb: typeof fastify.db, courseId: string) {
    const [course] = await tenantDb.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId));
    return course ?? null;
  }

  // PUT /tenant/content-items/:contentItemId/progress — spec FR-001..FR-007/FR-017, contracts §PUT.
  fastify.put<{ Params: { contentItemId: string }; Body: ProgressUpdateBody }>(
    "/tenant/content-items/:contentItemId/progress",
    { preHandler: [requireTenantUserSession()] },
    async (request, reply) => {
      const { contentItemId } = request.params;
      const body = request.body ?? {};

      const item = await resolveContentItem(request.tenantDb, contentItemId);
      if (!item) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const validation = validateProgressUpdate(body);
      if (validation.error) {
        return reply.code(400).send({ success: false, message: validation.error });
      }

      const sessionTimeSeconds = typeof body.sessionTimeSeconds === "number" ? body.sessionTimeSeconds : 0;
      const status = body.status as ProgressRow["status"];
      const scoreRaw = typeof body.scoreRaw === "number" ? body.scoreRaw : undefined;
      const scoreMin = typeof body.scoreMin === "number" ? body.scoreMin : undefined;
      const scoreMax = typeof body.scoreMax === "number" ? body.scoreMax : undefined;
      const bookmark = typeof body.bookmark === "string" ? body.bookmark : undefined;
      const suspendData = typeof body.suspendData === "string" ? body.suspendData : undefined;
      const now = new Date();

      // Only fields actually present in the request replace the stored value (FR-004/FR-005) — an
      // omitted field is left untouched on an existing row, matching this codebase's PATCH-style
      // partial-update convention (course-content's own module/content-item update handlers).
      const [row] = await request.tenantDb
        .insert(learnerContentProgress)
        .values({
          tenantId: request.user!.tenantId,
          userId: request.user!.id,
          contentItemId,
          status,
          scoreRaw: scoreRaw ?? null,
          scoreMin: scoreMin ?? null,
          scoreMax: scoreMax ?? null,
          bookmark: bookmark ?? null,
          suspendData: suspendData ?? null,
          sessionTimeSeconds,
          totalTimeSeconds: sessionTimeSeconds,
          enteredAt: now,
          exitedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [learnerContentProgress.tenantId, learnerContentProgress.userId, learnerContentProgress.contentItemId],
          set: {
            status,
            ...(scoreRaw !== undefined ? { scoreRaw } : {}),
            ...(scoreMin !== undefined ? { scoreMin } : {}),
            ...(scoreMax !== undefined ? { scoreMax } : {}),
            ...(bookmark !== undefined ? { bookmark } : {}),
            ...(suspendData !== undefined ? { suspendData } : {}),
            sessionTimeSeconds,
            totalTimeSeconds: sql`${learnerContentProgress.totalTimeSeconds} + ${sessionTimeSeconds}`,
            exitedAt: now,
            updatedAt: now,
          },
        })
        .returning();

      return reply.code(200).send({ success: true, data: toResponseRow(row) });
    },
  );

  // GET /tenant/content-items/:contentItemId/progress — spec FR-008/FR-010, contracts §GET single.
  fastify.get<{ Params: { contentItemId: string } }>(
    "/tenant/content-items/:contentItemId/progress",
    { preHandler: [requireTenantUserSession()] },
    async (request, reply) => {
      const { contentItemId } = request.params;
      const item = await resolveContentItem(request.tenantDb, contentItemId);
      if (!item) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const [row] = await request.tenantDb
        .select()
        .from(learnerContentProgress)
        .where(and(eq(learnerContentProgress.userId, request.user!.id), eq(learnerContentProgress.contentItemId, contentItemId)));

      return { success: true, data: row ? toResponseRow(row) : notStartedRow(contentItemId) };
    },
  );

  // GET /tenant/courses/:courseId/progress — spec FR-009/FR-010, contracts §GET course.
  fastify.get<{ Params: { courseId: string } }>(
    "/tenant/courses/:courseId/progress",
    { preHandler: [requireTenantUserSession()] },
    async (request, reply) => {
      const { courseId } = request.params;
      const course = await resolveCourse(request.tenantDb, courseId);
      if (!course) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      // `courseModules` is only joined for ordering, never for filtering (the `contentItems.courseId`
      // condition below already scopes this to the course on its own) — a standalone (module-less)
      // lesson has `contentItems.moduleId IS NULL`, so this must be a `leftJoin`. An `innerJoin` here
      // silently dropped every standalone lesson's progress from the response.
      const rows = await request.tenantDb
        .select({ progress: learnerContentProgress })
        .from(learnerContentProgress)
        .innerJoin(contentItems, eq(contentItems.id, learnerContentProgress.contentItemId))
        .leftJoin(courseModules, eq(courseModules.id, contentItems.moduleId))
        .where(and(eq(learnerContentProgress.userId, request.user!.id), eq(contentItems.courseId, courseId)))
        .orderBy(courseModules.position, contentItems.position);

      return { success: true, data: rows.map((r) => toResponseRow(r.progress)) };
    },
  );

  // GET /tenant/courses/:courseId/progress/learners — spec FR-011/FR-012, contracts §GET learners.
  fastify.get<{ Params: { courseId: string } }>(
    "/tenant/courses/:courseId/progress/learners",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("course.view", "course.manage")] },
    async (request, reply) => {
      const { courseId } = request.params;
      const course = await resolveCourse(request.tenantDb, courseId);
      if (!course) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      // Same `leftJoin` fix as the single-learner route above — this list must include standalone
      // lessons' progress too, not just module-scoped lessons.
      const rows = await request.tenantDb
        .select({ progress: learnerContentProgress, learner: { id: users.id, fullName: users.fullName, email: users.email } })
        .from(learnerContentProgress)
        .innerJoin(contentItems, eq(contentItems.id, learnerContentProgress.contentItemId))
        .leftJoin(courseModules, eq(courseModules.id, contentItems.moduleId))
        .innerJoin(users, eq(users.id, learnerContentProgress.userId))
        .where(eq(contentItems.courseId, courseId))
        .orderBy(courseModules.position, contentItems.position, users.fullName);

      const data = rows.map((r) => ({ learner: r.learner, ...toResponseRow(r.progress) }));
      return { success: true, data };
    },
  );
};

export default tenantProgressRoutes;
