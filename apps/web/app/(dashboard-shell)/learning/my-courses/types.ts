import type { Course } from "@/lib/course-api-types";

export type MyCourseStatus = "not_started" | "in_progress" | "completed";

/** One row in the "Upcoming Learnings" panel — either a real scheduled `live_class` session
 * (`scheduledAt` set) or the "pick up where you left off" fallback suggestion when nothing's
 * scheduled (`scheduledAt` omitted). Both are rendered by the same list item, just with a
 * different badge, which is why this is one shape instead of two near-identical ones. */
export interface UpcomingLearningItem {
  courseId: string;
  courseTitle: string;
  courseImageUrl: string | null;
  contentItemId: string;
  title: string;
  authorName: string | null;
  authorAvatarUrl: string | null;
  scheduledAt?: string;
}

/** Everything a single My Courses card needs, composed client-side from four already-existing
 * endpoints (curriculum, my progress, authors, reviews) — there is no single bulk endpoint for this,
 * so each course's data is fetched independently and merged here. */
export interface CourseCardData {
  course: Course;
  totalItems: number;
  completedItems: number;
  percent: number;
  status: MyCourseStatus;
  teacherName: string | null;
  teacherAvatarUrl: string | null;
  rating: { average: number; count: number } | null;
  liveClasses: UpcomingLearningItem[];
  nextItem: { contentItemId: string; title: string } | null;
  /** Most recent `updatedAt` across this course's progress rows — used only to pick which
   * in-progress course to suggest a next lesson from when nothing is scheduled. */
  lastActivityAt: string | null;
}
