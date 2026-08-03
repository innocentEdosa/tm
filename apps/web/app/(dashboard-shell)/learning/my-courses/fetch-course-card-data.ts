import { tenantFetch } from "@/lib/tenant-api-client";
import { flattenCourseOutline, type Course, type Curriculum, type CourseAuthor, type CourseReview, type ContentItem } from "@/lib/course-api-types";
import type { CourseCardData, UpcomingLearningItem } from "./types";

/** `GET /tenant/courses/:courseId/progress`'s response row (tenant-progress-routes.ts's own
 * `toResponseRow`) — the caller's own progress, never another learner's (server-scoped to
 * `request.user.id`, no client-supplied user id accepted anywhere in that route). */
interface MyProgressRow {
  contentItemId: string;
  status: "not_started" | "in_progress" | "completed" | "failed";
  updatedAt: string | null;
}

/**
 * Composes one My Courses card's worth of data from four existing, already-shipped endpoints — no
 * new backend routes. Mirrors `aggregateLearnerProgress`'s own "completed / total" convention
 * (course-api-types.ts), just computed for the signed-in learner's single course instead of every
 * learner across a course.
 */
export async function fetchCourseCardData(course: Course, subdomain: string): Promise<CourseCardData> {
  const [curriculumRes, progressRes, authorsRes, reviewsRes] = await Promise.all([
    tenantFetch<{ data: Curriculum }>(`/courses/${course.id}/curriculum`, { subdomain }),
    tenantFetch<{ data: MyProgressRow[] }>(`/courses/${course.id}/progress`, { subdomain }),
    tenantFetch<{ data: CourseAuthor[] }>(`/courses/${course.id}/authors`, { subdomain }),
    tenantFetch<{ data: CourseReview[] }>(`/courses/${course.id}/reviews`, { subdomain }),
  ]);

  const items = flattenCourseOutline(curriculumRes.data);
  const progressByItemId = new Map(progressRes.data.map((p) => [p.contentItemId, p]));

  const totalItems = items.length;
  const completedItems = items.filter((item) => progressByItemId.get(item.id)?.status === "completed").length;
  const percent = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
  const hasAnyProgress = progressRes.data.some((p) => p.status !== "not_started");
  const status: CourseCardData["status"] =
    totalItems > 0 && completedItems === totalItems ? "completed" : completedItems > 0 || hasAnyProgress ? "in_progress" : "not_started";

  const nextIncomplete = items.find((item) => progressByItemId.get(item.id)?.status !== "completed") ?? null;

  const primaryAuthor = authorsRes.data[0] ?? null;

  const liveClasses: UpcomingLearningItem[] = items
    .filter((item): item is ContentItem & { payload: { scheduledAt: string } } => item.type === "live_class" && !!item.payload.scheduledAt)
    .map((item) => ({
      courseId: course.id,
      courseTitle: course.title,
      courseImageUrl: course.courseImageUrl,
      contentItemId: item.id,
      title: item.title,
      authorName: primaryAuthor?.name ?? null,
      authorAvatarUrl: primaryAuthor?.profileImageUrl ?? null,
      scheduledAt: item.payload.scheduledAt,
    }));

  const lastActivityAt = progressRes.data.reduce<string | null>(
    (latest, row) => (row.updatedAt && (!latest || row.updatedAt > latest) ? row.updatedAt : latest),
    null,
  );

  // Flagged reviews are moderation-hidden (course-reviews schema's own intent) — excluded from both
  // the average and the count shown to a learner.
  const visibleReviews = reviewsRes.data.filter((r) => !r.flagged);
  const rating =
    visibleReviews.length > 0
      ? { average: visibleReviews.reduce((sum, r) => sum + r.rating, 0) / visibleReviews.length, count: visibleReviews.length }
      : null;

  return {
    course,
    totalItems,
    completedItems,
    percent,
    status,
    teacherName: primaryAuthor?.name ?? null,
    teacherAvatarUrl: primaryAuthor?.profileImageUrl ?? null,
    rating,
    liveClasses,
    nextItem: nextIncomplete ? { contentItemId: nextIncomplete.id, title: nextIncomplete.title } : null,
    lastActivityAt,
  };
}
