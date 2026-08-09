import type { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requirePermission } from "../permissions/require-permission";
import { courses } from "../db/schema/courses";
import { courseReviews } from "../db/schema/course-reviews";
import { users } from "../db/schema/users";
import { isCourseVisibleToCaller, wantsLearnerView } from "./tenant-course-routes";

type CourseReviewRow = typeof courseReviews.$inferSelect;

/**
 * Course Reviews panel. Read + moderate (flag, respond to a review) are staff-side
 * (`course.manage`); the learner-facing routes (list, "mine", the "Leave a rating" create/update)
 * are open to any authenticated tenant user ("My Learning accessible by everyone"), with per-course
 * visibility enforced via `isCourseVisibleToCaller` instead of a permission key.
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
  fastify.get<{ Params: { courseId: string }; Querystring: { asLearner?: string } }>(
    "/tenant/courses/:courseId/reviews",
    { preHandler: [requireTenantUserSession()] },
    async (request, reply) => {
      const { courseId } = request.params;
      const course = await resolveCourse(request.tenantDb, courseId);
      if (!course) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (!(await isCourseVisibleToCaller(request.tenantDb, request.user!.id, courseId, { asLearner: wantsLearnerView(request.query) }))) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      const rows = await request.tenantDb.select().from(courseReviews).where(eq(courseReviews.courseId, courseId)).orderBy(courseReviews.createdAt);
      return { success: true, data: rows.map(toResponseRow) };
    },
  );

  // GET /tenant/courses/:courseId/reviews/mine — the caller's own review on this course, or null.
  // Scoped to `request.user!.id` server-side, same convention as every other "mine" lookup in this
  // app (`tenant-progress-routes.ts`'s own progress rows) — never a client-supplied user id.
  fastify.get<{ Params: { courseId: string }; Querystring: { asLearner?: string } }>(
    "/tenant/courses/:courseId/reviews/mine",
    { preHandler: [requireTenantUserSession()] },
    async (request, reply) => {
      const { courseId } = request.params;
      const course = await resolveCourse(request.tenantDb, courseId);
      if (!course) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (!(await isCourseVisibleToCaller(request.tenantDb, request.user!.id, courseId, { asLearner: wantsLearnerView(request.query) }))) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      const [review] = await request.tenantDb
        .select()
        .from(courseReviews)
        .where(and(eq(courseReviews.courseId, courseId), eq(courseReviews.userId, request.user!.id)));
      return { success: true, data: review ? toResponseRow(review) : null };
    },
  );

  // POST /tenant/courses/:courseId/reviews — the "Leave a rating" flow. Upserts on (courseId,
  // userId): a learner gets exactly one review per course, editing it in place on a second submit
  // (status flips to "updated") rather than accumulating duplicates. `learnerName`/`learnerEmail` are
  // resolved server-side from `request.user!.id`, same as every other "self" write in this app —
  // never accepted from the request body.
  fastify.post<{ Params: { courseId: string }; Querystring: { asLearner?: string }; Body: { rating?: number; reviewText?: string | null } }>(
    "/tenant/courses/:courseId/reviews",
    { preHandler: [requireTenantUserSession()] },
    async (request, reply) => {
      const { courseId } = request.params;
      const { rating, reviewText } = request.body ?? {};
      if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
        return reply.code(400).send({ success: false, message: "rating must be an integer between 1 and 5" });
      }
      const course = await resolveCourse(request.tenantDb, courseId);
      if (!course) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (!(await isCourseVisibleToCaller(request.tenantDb, request.user!.id, courseId, { asLearner: wantsLearnerView(request.query) }))) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const [author] = await request.tenantDb.select({ fullName: users.fullName, email: users.email }).from(users).where(eq(users.id, request.user!.id));
      const trimmedText = reviewText?.trim() || null;

      const [existing] = await request.tenantDb
        .select({ id: courseReviews.id })
        .from(courseReviews)
        .where(and(eq(courseReviews.courseId, courseId), eq(courseReviews.userId, request.user!.id)));

      if (existing) {
        const [updated] = await request.tenantDb
          .update(courseReviews)
          .set({ rating, reviewText: trimmedText, status: "updated" })
          .where(eq(courseReviews.id, existing.id))
          .returning();
        return reply.code(200).send({ success: true, data: toResponseRow(updated) });
      }

      const [created] = await request.tenantDb
        .insert(courseReviews)
        .values({
          tenantId: request.user!.tenantId,
          courseId,
          userId: request.user!.id,
          learnerName: author?.fullName ?? "Learner",
          learnerEmail: author?.email ?? "",
          rating,
          reviewText: trimmedText,
        })
        .returning();
      return reply.code(201).send({ success: true, data: toResponseRow(created) });
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
