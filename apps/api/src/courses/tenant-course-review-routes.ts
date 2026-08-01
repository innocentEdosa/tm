import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requirePermission, requireAnyPermission } from "../permissions/require-permission";
import { courses } from "../db/schema/courses";
import { courseReviews } from "../db/schema/course-reviews";
import { users } from "../db/schema/users";

type CourseReviewRow = typeof courseReviews.$inferSelect;

/**
 * Course Reviews panel — new schema/routes built as forward-compatible groundwork alongside the
 * course-authoring wiring pass (mirroring `courses.subcategory`'s own precedent): there is no
 * learner-facing review-submission surface anywhere in this app yet, so this table has no creation
 * endpoint and will read as an empty list until a future spec adds one. Read + moderate only (flag,
 * respond to a review). Reuses `course.view`/`course.manage` — no new permission keys.
 */
const tenantCourseReviewRoutes: FastifyPluginAsync = async (fastify) => {
  async function resolveCourse(tenantDb: typeof fastify.db, courseId: string) {
    const [course] = await tenantDb.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId));
    return course ?? null;
  }

  async function resolveReview(tenantDb: typeof fastify.db, reviewId: string) {
    const [review] = await tenantDb.select().from(courseReviews).where(eq(courseReviews.id, reviewId));
    return review ?? null;
  }

  function toResponseRow(r: CourseReviewRow) {
    return {
      id: r.id,
      learnerName: r.learnerName,
      learnerEmail: r.learnerEmail,
      rating: r.rating,
      reviewText: r.reviewText,
      status: r.status,
      flagged: r.flagged,
      response:
        r.responseText !== null
          ? { text: r.responseText, authorName: r.responseAuthorName, publishedAt: r.responsePublishedAt }
          : null,
      createdAt: r.createdAt,
    };
  }

  // GET /tenant/courses/:courseId/reviews
  fastify.get<{ Params: { courseId: string } }>(
    "/tenant/courses/:courseId/reviews",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("course.view", "course.manage")] },
    async (request, reply) => {
      const { courseId } = request.params;
      const course = await resolveCourse(request.tenantDb, courseId);
      if (!course) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      const rows = await request.tenantDb.select().from(courseReviews).where(eq(courseReviews.courseId, courseId)).orderBy(courseReviews.createdAt);
      return { success: true, data: rows.map(toResponseRow) };
    },
  );

  // PATCH /tenant/course-reviews/:reviewId/flag — moderation only, never deletes the review.
  fastify.patch<{ Params: { reviewId: string }; Body: { flagged?: boolean } }>(
    "/tenant/course-reviews/:reviewId/flag",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { reviewId } = request.params;
      if (typeof request.body?.flagged !== "boolean") {
        return reply.code(400).send({ success: false, message: "flagged must be a boolean" });
      }
      const existing = await resolveReview(request.tenantDb, reviewId);
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      const [updated] = await request.tenantDb
        .update(courseReviews)
        .set({ flagged: request.body.flagged })
        .where(eq(courseReviews.id, reviewId))
        .returning();
      return reply.code(200).send({ success: true, data: toResponseRow(updated) });
    },
  );

  // POST /tenant/course-reviews/:reviewId/response — the responding tenant user's own name is looked
  // up server-side (never client-supplied) so it can't be spoofed as someone else's response.
  fastify.post<{ Params: { reviewId: string }; Body: { text?: string } }>(
    "/tenant/course-reviews/:reviewId/response",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { reviewId } = request.params;
      if (!request.body?.text?.trim()) {
        return reply.code(400).send({ success: false, message: "text is required" });
      }
      const existing = await resolveReview(request.tenantDb, reviewId);
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      const [author] = await request.tenantDb.select({ fullName: users.fullName }).from(users).where(eq(users.id, request.user!.id));

      const [updated] = await request.tenantDb
        .update(courseReviews)
        .set({ responseText: request.body.text.trim(), responseAuthorName: author?.fullName ?? null, responsePublishedAt: new Date() })
        .where(eq(courseReviews.id, reviewId))
        .returning();
      return reply.code(201).send({ success: true, data: toResponseRow(updated) });
    },
  );

  // PATCH /tenant/course-reviews/:reviewId/response — edits an existing response's text only.
  fastify.patch<{ Params: { reviewId: string }; Body: { text?: string } }>(
    "/tenant/course-reviews/:reviewId/response",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { reviewId } = request.params;
      if (!request.body?.text?.trim()) {
        return reply.code(400).send({ success: false, message: "text is required" });
      }
      const existing = await resolveReview(request.tenantDb, reviewId);
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (existing.responseText === null) {
        return reply.code(422).send({ success: false, message: "This review has no response to edit" });
      }
      const [updated] = await request.tenantDb
        .update(courseReviews)
        .set({ responseText: request.body.text.trim() })
        .where(eq(courseReviews.id, reviewId))
        .returning();
      return reply.code(200).send({ success: true, data: toResponseRow(updated) });
    },
  );

  // DELETE /tenant/course-reviews/:reviewId/response — clears the response, keeps the review itself.
  fastify.delete<{ Params: { reviewId: string } }>(
    "/tenant/course-reviews/:reviewId/response",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { reviewId } = request.params;
      const existing = await resolveReview(request.tenantDb, reviewId);
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      await request.tenantDb
        .update(courseReviews)
        .set({ responseText: null, responseAuthorName: null, responsePublishedAt: null })
        .where(eq(courseReviews.id, reviewId));
      return reply.code(200).send({ success: true });
    },
  );
};

export default tenantCourseReviewRoutes;
