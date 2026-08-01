/** Response shapes for the real course-authoring API (apps/api/src/courses, course-content,
 * attachments, progress) — mirrors each route's own response-row builder exactly, the same role
 * `mock-course-data.ts`'s types played for the mock store this replaces. */

export type DeliveryMode = "in_person" | "virtual" | "self_paced" | "blended";
export type DurationUnit = "minutes" | "hours" | "days";
export type CourseStatus = "draft" | "active" | "archived";
export type ContentStatus = "draft" | "published";
export type ContentItemType = "video" | "article" | "live_class" | "test" | "assignment" | "external_import";

export interface CourseCategory {
  id: string;
  name: string;
}

export interface UserRef {
  id: string;
  fullName: string;
}

export interface Course {
  id: string;
  title: string;
  description: string | null;
  category: CourseCategory | null;
  deliveryMode: DeliveryMode;
  duration: { value: number; unit: DurationUnit };
  provider: string | null;
  cost: number | null;
  subcategory: string | null;
  learningObjectives: string[];
  requirements: string[];
  courseImageUrl: string | null;
  moduleCount: number;
  status: CourseStatus;
  createdBy: UserRef | null;
  createdAt: string;
  updatedBy: UserRef | null;
  updatedAt: string;
}

export interface ContentItemPayload {
  url?: string;
  body?: string;
  externalUrl?: string;
  scheduledAt?: string;
  sourceType?: string;
}

export interface ContentItem {
  id: string;
  type: ContentItemType;
  title: string;
  description: string | null;
  payload: ContentItemPayload;
  status: ContentStatus;
  createdBy: UserRef | null;
  createdAt: string;
  updatedBy: UserRef | null;
  updatedAt: string;
}

export interface CourseModule {
  id: string;
  title: string;
  description: string | null;
  status: ContentStatus;
  contentItems?: ContentItem[];
  createdBy: UserRef | null;
  createdAt: string;
  updatedBy: UserRef | null;
  updatedAt: string;
}

/** Where a new content item is being added — a specific module, or standalone (course-level, no
 * module). Mirrors the shape both the module-scoped and course-scoped content-item POST endpoints
 * expect. */
export type ContentItemTarget = { moduleId: string } | { courseId: string };

export interface Curriculum {
  modules: CourseModule[];
  standaloneContentItems: ContentItem[];
  outlineOrder: string[];
}

/** One entry in a course's top-level outline — a module or a standalone lesson, resolved from
 * `Curriculum.outlineOrder` against `modules`/`standaloneContentItems`. Mirrors the mock UI's own
 * `CourseOutlineEntry`. */
export type CourseOutlineEntry = { id: string; kind: "module"; module: CourseModule } | { id: string; kind: "lesson"; item: ContentItem };

export function buildCourseOutline(curriculum: Curriculum): CourseOutlineEntry[] {
  const modulesById = new Map(curriculum.modules.map((m) => [m.id, m]));
  const itemsById = new Map(curriculum.standaloneContentItems.map((c) => [c.id, c]));
  const entries: CourseOutlineEntry[] = [];
  for (const id of curriculum.outlineOrder) {
    const mod = modulesById.get(id);
    if (mod) {
      entries.push({ id, kind: "module", module: mod });
      continue;
    }
    const item = itemsById.get(id);
    if (item) entries.push({ id, kind: "lesson", item });
  }
  return entries;
}

export interface Attachment {
  id: string;
  kind: "file" | "link";
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  url: string | null;
  status: "pending" | "ready";
  createdBy: UserRef | null;
  createdAt: string;
}

export interface CourseAuthor {
  id: string;
  name: string;
  email: string;
  roleOrDescription: string | null;
  profileImageUrl: string | null;
  addedBy: UserRef | null;
  createdAt: string;
}

export interface CourseLearnerProgressRow {
  learner: { id: string; fullName: string; email: string };
  contentItemId: string;
  status: "not_started" | "in_progress" | "completed" | "failed";
  totalTimeSeconds: number;
  enteredAt: string | null;
  exitedAt: string | null;
  updatedAt: string | null;
}

/** A course-level "learner + overall progress" row, aggregated client-side from
 * `CourseLearnerProgressRow[]` — spec 026 deliberately has no server-side course-level rollup. */
export interface CourseLearnerSummary {
  id: string;
  name: string;
  email: string;
  progressPercent: number;
  enrolledAt: string;
}

export function aggregateLearnerProgress(rows: CourseLearnerProgressRow[], totalContentItems: number): CourseLearnerSummary[] {
  const byLearner = new Map<string, { name: string; email: string; completed: number; enteredAts: string[] }>();
  for (const row of rows) {
    const entry = byLearner.get(row.learner.id) ?? { name: row.learner.fullName, email: row.learner.email, completed: 0, enteredAts: [] };
    if (row.status === "completed") entry.completed += 1;
    if (row.enteredAt) entry.enteredAts.push(row.enteredAt);
    byLearner.set(row.learner.id, entry);
  }
  return Array.from(byLearner.entries()).map(([id, entry]) => ({
    id,
    name: entry.name,
    email: entry.email,
    progressPercent: totalContentItems > 0 ? Math.round((entry.completed / totalContentItems) * 100) : 0,
    enrolledAt: entry.enteredAts.sort()[0] ?? "",
  }));
}

export interface CourseReviewResponse {
  text: string;
  authorName: string | null;
  publishedAt: string | null;
}

export interface CourseReview {
  id: string;
  learnerName: string;
  learnerEmail: string;
  rating: number;
  reviewText: string | null;
  status: "published" | "updated";
  flagged: boolean;
  response: CourseReviewResponse | null;
  createdAt: string;
}
