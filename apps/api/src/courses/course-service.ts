import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { userHasAnyPermission } from "../permissions/require-permission";
import { courses } from "../db/schema/courses";
import { courseModules, contentItems } from "../db/schema/course-content";
import { fileAttachments } from "../db/schema/file-attachments";
import { resolveOrCreateCourseCategory } from "./course-category-resolution";
import { buildAssignmentVisibilityCondition, toResponseRows } from "./tenant-course-routes";
import { deleteAllAttachmentsForEntity } from "../attachments/tenant-attachment-routes";
import { CONTENT_ITEM_TYPES, validateContentItemPayload, type ContentItemType } from "../course-content/content-item-payload-validation";
import type { ImageCandidate } from "../images/image-provider";
import { revertToDraftIfPublished } from "./revert-course-to-draft";

/**
 * The application-service boundary for the tenant-scoped side of Course Management (AI Foundation
 * Phase 3, same principle as `form-builder/form-service.ts`). Extracted out of
 * `courses/tenant-course-routes.ts` and `course-content/tenant-course-content-routes.ts`'s handlers
 * with no behavior change, so a second caller (`ai/tools/courses.ts`) can invoke the exact same
 * operations a human triggers through the UI, through the same `request.tenantDb`/RLS path. Reuses
 * those routes' own exported helpers (`buildAssignmentVisibilityCondition`, `toResponseRows`,
 * `resolveOrCreateCourseCategory`) rather than reimplementing them — same "one shared implementation,
 * not a parallel copy" precedent `tenant-marketplace-routes.ts` already set by importing
 * `toResponseRows` itself.
 *
 * Now covers `listCourses`/`getCourse`/`listModules`/`listLessons`/`createCourse`/`createModule`/
 * `createLesson`, (AI Course Editing Phase 1) `updateCourse`/`updateModule`/`updateLesson`, and
 * (Course Organization AI Phase 1) `reorderModules`/`reorderLessons`/`archiveModule`/`archiveLesson`
 * — the full set any current AI tool or HTTP route actually calls. Each update method mirrors its
 * route's FULL capability, including fields the AI tools deliberately never send (course/module/lesson
 * `status` — see `ai/tools/courses.ts`'s module doc comment on why the AI-facing schemas exclude it
 * even though the service itself supports it for the HTTP routes' sake).
 *
 * Concurrent-edit staleness (AI Course Editing Phase 1, "concurrent changes"): audited this codebase
 * for an existing optimistic-locking pattern (a version/`updatedAt` check before writing) before
 * adding update methods here — there is none, anywhere, for any resource (forms, departments,
 * courses before this phase). Every `updateX` below is last-write-wins, exactly like the HTTP routes
 * it was extracted from always were — a real gap (an AI proposal confirmed after someone else edited
 * the same field through the UI silently overwrites their change, field-by-field, same as two browser
 * tabs racing today) but not a new one this phase introduced, and not a pattern to invent unilaterally
 * for AI-initiated writes alone while every other write path in the app stays unprotected. Documented
 * here rather than silently accepted.
 */

/** Never trust a tenantId a caller could have supplied — this always comes from the same
 * server-resolved session context every existing route already uses (`request.user.tenantId`/
 * `request.tenantDb`), never from tool/prompt/request-body input. */
export interface CourseServiceContext {
  tenantId: string;
  userId: string;
  db: Db;
}

export const DELIVERY_MODES = ["in_person", "virtual", "self_paced", "blended"] as const;
export const DURATION_UNITS = ["minutes", "hours", "days"] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];
export type DurationUnit = (typeof DURATION_UNITS)[number];

/** A course's own status domain — distinct from `PUBLISH_STATUSES` below, which modules and content
 * items share instead. `updateCourse` validates against this because `PATCH /tenant/courses/:id`
 * always has (no restricted transition graph, per that route's own doc comment) — but no AI tool
 * schema ever includes `status` (AI Course Editing Phase 1: "the AI must not implicitly publish or
 * activate anything"), so in practice only the HTTP route path ever actually sends one. */
export const COURSE_STATUSES = ["draft", "active", "archived"] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

/** Shared by course modules and content items, independent of their parent course's own
 * `COURSE_STATUSES`. `archived` (Course Organization AI Phase 1) mirrors `COURSE_STATUSES`'s own
 * draft/active/archived pattern — no restricted transition graph, reachable from (and reversible to)
 * any other status via a plain update, never a delete (data-model unchanged; only this column's
 * legal values grew — see migration 0123). `update_course_module`/`update_course_lesson`'s AI
 * schemas still never send `status` at all (same "service supports it, no AI tool schema sends it"
 * reasoning as `COURSE_STATUSES`); the new `archive_course_module`/`archive_course_lesson` tools are
 * the only AI-facing way to reach `archived`, via the dedicated `archiveModule`/`archiveLesson`
 * methods below, not a general status setter. */
export const PUBLISH_STATUSES = ["draft", "published", "archived"] as const;
export type PublishStatus = (typeof PUBLISH_STATUSES)[number];

/** Three codes, not two, because the existing routes' contract already distinguishes "a required
 * field is missing" (400) from "a field has a value but it's not a valid one" (422) — collapsing
 * that into one code would change response status codes callers (and `course-create-validation.test.ts`
 * et al.) already depend on. */
export type CourseServiceError = { code: "not_found" | "missing_required" | "invalid"; message: string };
export type CourseServiceResult<T> = { ok: true; data: T } | { ok: false; error: CourseServiceError };

function ok<T>(data: T): CourseServiceResult<T> {
  return { ok: true, data };
}
function fail<T>(code: CourseServiceError["code"], message: string): CourseServiceResult<T> {
  return { ok: false, error: { code, message } };
}


/** AI Image Discovery & Course Asset Management Phase 1 — the shape written into
 * `file_attachments.metadata` (migration 0124) for an AI-selected image. Only ever built from a
 * server-verified `ImageCandidate` (never from raw AI tool input) — see `ai/tools/images.ts`'s
 * `resolveCandidateFromRecentSearches`. Every field is optional in storage since a future provider
 * might not supply all of them; `null` is preserved rather than omitted so a reader can distinguish
 * "this provider doesn't have one" from "field not implemented yet." */
function buildImageAttachmentMetadata(candidate: ImageCandidate): Record<string, unknown> {
  return {
    provider: candidate.provider,
    providerImageId: candidate.providerImageId,
    authorName: candidate.author,
    authorUrl: candidate.authorUrl,
    sourceUrl: candidate.sourceUrl,
    license: candidate.license,
    licenseUrl: candidate.licenseUrl,
  };
}

export interface ListCoursesFilters {
  search?: string;
  category?: string;
  deliveryMode?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateCourseInput {
  title?: string;
  description?: string | null;
  category?: string;
  deliveryMode?: DeliveryMode;
  duration?: { value?: number; unit?: DurationUnit };
  provider?: string | null;
  cost?: number | null;
  subcategory?: string | null;
  learningObjectives?: string[];
  requirements?: string[];
}

export interface CreateModuleInput {
  title?: string;
  description?: string | null;
}

export interface CreateLessonInput {
  type?: string;
  title?: string;
  description?: string | null;
  payload?: Record<string, unknown>;
}

/** Course Generation Phase 1 — no existing precedent set a size limit anywhere in this schema (a
 * human using the editor can add as many modules/lessons as they want, one at a time, each its own
 * deliberate action); an AI generating an entire structure from one request needs an explicit,
 * documented ceiling instead ("do not use arbitrary huge limits... the AI must not be allowed to
 * generate an unbounded course"). Chosen values: generous enough for a real course (a 10-module,
 * 8-lesson-per-module course is 80 lessons, already a substantial course), small enough that a
 * request exceeding them (the task's own example: "a 12-module course") hits a real, explainable
 * limit rather than silently truncating. */
export const GENERATION_LIMITS = {
  minModules: 1,
  maxModules: 10,
  minLessonsPerModule: 1,
  maxLessonsPerModule: 8,
  maxLearningObjectives: 10,
  maxRequirements: 10,
} as const;

export interface GenerateLessonInput {
  title?: string;
  description?: string | null;
}

export interface GenerateModuleInput {
  title?: string;
  description?: string | null;
  lessons: GenerateLessonInput[];
}

/** Deliberately narrower than `CreateCourseInput` — no `status` (always `draft`, exactly like
 * `createCourse`), and every module's lessons are structural only: `title`/`description`, never
 * `type`/`payload`. `generateCourseStructure` below hardcodes every generated lesson's `type` to
 * `"article"` with a minimal, honest placeholder body — see that method's own doc comment for why
 * (Phase 5 of the Course Generation task: "do not fabricate data," but `article` is the only content
 * type whose payload validation can be satisfied without inventing a URL/schedule/external source). */
export interface GenerateCourseStructureInput {
  title?: string;
  description?: string | null;
  category?: string;
  deliveryMode?: DeliveryMode;
  duration?: { value?: number; unit?: DurationUnit };
  provider?: string | null;
  cost?: number | null;
  subcategory?: string | null;
  learningObjectives?: string[];
  requirements?: string[];
  modules: GenerateModuleInput[];
}

/** Shared by the AI tool's own Zod `.superRefine()` (rejects a malformed plan before a proposal is
 * even created) and `CourseService.generateCourseStructure` (defense-in-depth at confirm time,
 * exactly the same two-entry-point relationship `validateContentItemPayload` already has with
 * `create_course_lesson`'s schema) — one implementation, not two independently-maintained copies.
 * Catches: too few/many modules, too few/many lessons in any one module, a blank module or lesson
 * title, a duplicate module title, or a duplicate lesson title within the same module (Phase 7:
 * "avoid duplicate module titles, duplicate lesson titles within the same module, empty modules,
 * empty lesson titles"). Cross-module duplicate lesson titles are allowed (e.g. two different
 * modules each having an "Overview" lesson is normal, not a defect). */
export function validateGenerationPlan(plan: { modules: GenerateModuleInput[] }): CourseServiceError | null {
  if (plan.modules.length < GENERATION_LIMITS.minModules || plan.modules.length > GENERATION_LIMITS.maxModules) {
    return { code: "invalid", message: `A generated course must have between ${GENERATION_LIMITS.minModules} and ${GENERATION_LIMITS.maxModules} modules (got ${plan.modules.length}).` };
  }
  const moduleTitles = new Set<string>();
  for (const module of plan.modules) {
    if (!module.title?.trim()) {
      return { code: "invalid", message: "Every module needs a non-blank title." };
    }
    const normalizedModuleTitle = module.title.trim().toLowerCase();
    if (moduleTitles.has(normalizedModuleTitle)) {
      return { code: "invalid", message: `Duplicate module title: "${module.title}".` };
    }
    moduleTitles.add(normalizedModuleTitle);

    if (module.lessons.length < GENERATION_LIMITS.minLessonsPerModule || module.lessons.length > GENERATION_LIMITS.maxLessonsPerModule) {
      return {
        code: "invalid",
        message: `Module "${module.title}" must have between ${GENERATION_LIMITS.minLessonsPerModule} and ${GENERATION_LIMITS.maxLessonsPerModule} lessons (got ${module.lessons.length}).`,
      };
    }
    const lessonTitles = new Set<string>();
    for (const lesson of module.lessons) {
      if (!lesson.title?.trim()) {
        return { code: "invalid", message: `Every lesson needs a non-blank title (in module "${module.title}").` };
      }
      const normalizedLessonTitle = lesson.title.trim().toLowerCase();
      if (lessonTitles.has(normalizedLessonTitle)) {
        return { code: "invalid", message: `Duplicate lesson title "${lesson.title}" within module "${module.title}".` };
      }
      lessonTitles.add(normalizedLessonTitle);
    }
  }
  return null;
}

/** All optional — `updateCourse` only ever writes the fields actually present (`!== undefined`),
 * exactly like `PATCH /tenant/courses/:courseId` already does. `learningObjectives`/`requirements`
 * live on a separate HTTP route (`PATCH /tenant/courses/:courseId/objectives`) for historical
 * frontend-UX reasons (a separate save button on a separate panel) — folded into this one service
 * method anyway since CourseService is the shared abstraction, not a route-boundary mirror; both
 * routes call into this same method with their own subset of fields (see Phase 3's "consolidate,
 * don't duplicate" instruction). */
export interface UpdateCourseInput {
  title?: string;
  description?: string | null;
  category?: string;
  deliveryMode?: DeliveryMode;
  duration?: { value?: number; unit?: DurationUnit };
  provider?: string | null;
  cost?: number | null;
  subcategory?: string | null;
  status?: CourseStatus;
  learningObjectives?: string[];
  requirements?: string[];
}

export interface UpdateModuleInput {
  title?: string;
  description?: string | null;
  status?: PublishStatus;
}

/** No `type` field — content-item type is immutable once created (`PATCH /tenant/content-items/:id`
 * itself rejects a `type` change with 422 "type cannot be changed once created"); `updateLesson`
 * preserves that exactly, and no `moduleId` field either — moving a lesson between modules has
 * outline-order side effects (`courses.outlineOrder` add/remove) genuinely close to "reorder," which
 * is explicitly out of scope for this phase. Documented here rather than silently narrowing the
 * route's own capability: `PATCH /tenant/content-items/:id` still supports moving a lesson via the
 * UI; `updateLesson`/`update_course_lesson` deliberately don't expose that yet. */
export interface UpdateLessonInput {
  title?: string;
  description?: string | null;
  payload?: Record<string, unknown>;
  status?: PublishStatus;
}

export interface CourseModuleSummary {
  id: string;
  title: string;
  description: string | null;
  position: number;
  status: string;
  lessonCount: number;
}

const DEFAULT_PAGE_SIZE = 20;

/** Shared by `getCourse` and `listModules` — assumes the caller already confirmed the course row
 * exists; this only answers "is it visible to this caller" (`course.manage` bypasses; everyone
 * else needs `buildAssignmentVisibilityCondition`), same rule `GET /tenant/courses/:courseId`
 * applies. Factored out so module discovery can't drift from course-detail visibility over time. */
async function isCourseVisibleToCaller(ctx: CourseServiceContext, courseId: string): Promise<boolean> {
  const canManage = await userHasAnyPermission(ctx.db, ctx.userId, ["course.manage"]);
  if (canManage) return true;
  const [visible] = await ctx.db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.id, courseId), buildAssignmentVisibilityCondition(ctx.userId)));
  return !!visible;
}

/** Extracted verbatim from `POST /tenant/courses`'s validation (`tenant-course-routes.ts`'s
 * `validateFields`, narrowed to the subset `createCourse` accepts — no `status` field, since a
 * newly created course is always `draft`, matching that route's own behavior). */
function validateCreateCourseInput(input: CreateCourseInput): CourseServiceError | null {
  if (!input.title?.trim() || !input.category?.trim() || !input.deliveryMode || input.duration?.value === undefined || !input.duration?.unit) {
    return { code: "missing_required", message: "title, category, deliveryMode, and duration (value and unit) are required" };
  }
  if (!DELIVERY_MODES.includes(input.deliveryMode)) {
    return { code: "invalid", message: "Invalid deliveryMode" };
  }
  if (!DURATION_UNITS.includes(input.duration.unit)) {
    return { code: "invalid", message: "Invalid duration.unit" };
  }
  if (!(input.duration.value > 0)) {
    return { code: "invalid", message: "duration.value must be greater than 0" };
  }
  if (input.cost !== undefined && input.cost !== null && input.cost < 0) {
    return { code: "invalid", message: "cost must be >= 0" };
  }
  return null;
}

/** Extracted verbatim from `PATCH /tenant/courses/:courseId`'s `validateFields` — every field
 * optional (a PATCH, unlike POST, never has "missing required" failures of its own), same enum/range
 * checks. */
function validateUpdateCourseInput(input: UpdateCourseInput): CourseServiceError | null {
  if (input.deliveryMode !== undefined && !DELIVERY_MODES.includes(input.deliveryMode)) {
    return { code: "invalid", message: "Invalid deliveryMode" };
  }
  if (input.duration?.unit !== undefined && !DURATION_UNITS.includes(input.duration.unit)) {
    return { code: "invalid", message: "Invalid duration.unit" };
  }
  if (input.duration?.value !== undefined && !(input.duration.value > 0)) {
    return { code: "invalid", message: "duration.value must be greater than 0" };
  }
  if (input.cost !== undefined && input.cost !== null && input.cost < 0) {
    return { code: "invalid", message: "cost must be >= 0" };
  }
  if (input.status !== undefined && !COURSE_STATUSES.includes(input.status)) {
    return { code: "invalid", message: "Invalid status" };
  }
  return null;
}

export const CourseService = {
  /** Extracted from `GET /tenant/courses` — same visibility rule (a `course.manage` holder sees
   * every course; anyone else only sees courses `buildAssignmentVisibilityCondition` reaches),
   * same default "hide archived unless explicitly requested" filter, same pagination shape. */
  async listCourses(ctx: CourseServiceContext, filters: ListCoursesFilters = {}): Promise<CourseServiceResult<{ courses: Awaited<ReturnType<typeof toResponseRows>>; pagination: { page: number; pageSize: number; total: number } }>> {
    const conditions = [eq(courses.tenantId, ctx.tenantId)];

    const canManage = await userHasAnyPermission(ctx.db, ctx.userId, ["course.manage"]);
    if (!canManage) {
      conditions.push(buildAssignmentVisibilityCondition(ctx.userId));
    }

    if (filters.status) {
      conditions.push(eq(courses.status, filters.status));
    } else {
      conditions.push(ne(courses.status, "archived"));
    }
    if (filters.category) conditions.push(eq(courses.categoryId, filters.category));
    if (filters.deliveryMode) conditions.push(eq(courses.deliveryMode, filters.deliveryMode));
    if (filters.search) conditions.push(sql`${courses.title} ILIKE ${`%${filters.search}%`}`);

    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE);

    const [{ count: total }] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(courses)
      .where(and(...conditions));

    const rows = await ctx.db
      .select()
      .from(courses)
      .where(and(...conditions))
      .orderBy(desc(courses.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const data = await toResponseRows(ctx.db, rows, ctx.userId);
    return ok({ courses: data, pagination: { page, pageSize, total } });
  },

  /** Extracted from `GET /tenant/courses/:courseId` — same "not found" shape for both "doesn't
   * exist" and "exists but not visible to this caller" (a learner outside the assigned audience
   * can't distinguish the two, exactly as that route already guarantees). */
  async getCourse(ctx: CourseServiceContext, courseId: string): Promise<CourseServiceResult<Awaited<ReturnType<typeof toResponseRows>>[number]>> {
    const [existing] = await ctx.db.select().from(courses).where(eq(courses.id, courseId));
    if (!existing) {
      return fail("not_found", "Course not found");
    }
    if (!(await isCourseVisibleToCaller(ctx, courseId))) {
      return fail("not_found", "Course not found");
    }

    const [data] = await toResponseRows(ctx.db, [existing], ctx.userId);
    return ok(data);
  },

  /** Module discovery (Course AI context/discoverability hardening) — lets a caller (human or AI
   * tool) resolve a module referenced by name into its id, see ordering, and see how many lessons
   * each module already has, without pulling in the full curriculum (modules + every content item +
   * their payloads) the way `GET /tenant/courses/:courseId/curriculum` does. Same visibility rule as
   * `getCourse`: not_found for both "course doesn't exist" and "exists but not visible to this
   * caller" — a module list is exactly as sensitive as the course it belongs to, never available
   * through a separate, looser check. `lessonCount` is computed here (grouped count over
   * `content_items`), not stored — mirrors `courses.moduleCount`'s own precedent in `toResponseRows`. */
  async listModules(ctx: CourseServiceContext, courseId: string): Promise<CourseServiceResult<CourseModuleSummary[]>> {
    const [existing] = await ctx.db.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId));
    if (!existing) {
      return fail("not_found", "Course not found");
    }
    if (!(await isCourseVisibleToCaller(ctx, courseId))) {
      return fail("not_found", "Course not found");
    }

    const moduleRows = await ctx.db.select().from(courseModules).where(eq(courseModules.courseId, courseId)).orderBy(courseModules.position);
    const moduleIds = moduleRows.map((m) => m.id);
    const lessonCountRows =
      moduleIds.length > 0
        ? await ctx.db
            .select({ moduleId: contentItems.moduleId, count: sql<number>`count(*)::int` })
            .from(contentItems)
            .where(inArray(contentItems.moduleId, moduleIds))
            .groupBy(contentItems.moduleId)
        : [];
    const lessonCountByModuleId = new Map(lessonCountRows.map((r) => [r.moduleId, r.count]));

    return ok(
      moduleRows.map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        position: m.position,
        status: m.status,
        lessonCount: lessonCountByModuleId.get(m.id) ?? 0,
      })),
    );
  },

  /** Lesson discovery (AI Course Editing Phase 1) — the same reasoning as `listModules` (Course AI
   * context/discoverability hardening, prior phase), now applied one level down: `update_course_lesson`
   * needs a way to resolve "the second lesson in that module" or "the Phishing Basics lesson" into a
   * real content-item id, and nothing in the registry could answer that (`list_course_modules` only
   * returns each module's lesson *count*, never the lessons themselves). Same visibility rule as
   * `listModules`: not_found for both "course doesn't exist" and "not visible to this caller."
   * `moduleId`, if given, narrows to one module's lessons (in position order); omitted, returns every
   * lesson in the course — module-scoped and standalone — each row's own `moduleId` (`null` for
   * standalone) telling the caller where it lives. */
  async listLessons(ctx: CourseServiceContext, courseId: string, moduleId?: string): Promise<CourseServiceResult<Array<{ id: string; title: string; description: string | null; type: string; status: string; position: number; moduleId: string | null }>>> {
    const [existing] = await ctx.db.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId));
    if (!existing) {
      return fail("not_found", "Course not found");
    }
    if (!(await isCourseVisibleToCaller(ctx, courseId))) {
      return fail("not_found", "Course not found");
    }

    if (moduleId) {
      const [module] = await ctx.db.select({ id: courseModules.id }).from(courseModules).where(and(eq(courseModules.id, moduleId), eq(courseModules.courseId, courseId)));
      if (!module) {
        return fail("not_found", "Module not found");
      }
    }

    const conditions = moduleId ? [eq(contentItems.courseId, courseId), eq(contentItems.moduleId, moduleId)] : [eq(contentItems.courseId, courseId)];
    const itemRows = await ctx.db
      .select()
      .from(contentItems)
      .where(and(...conditions))
      .orderBy(contentItems.position);

    return ok(
      itemRows.map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        type: c.type,
        status: c.status,
        position: c.position,
        moduleId: c.moduleId,
      })),
    );
  },

  /** AI Lesson Content & Assessment Generation phase — `listLessons` deliberately omits `payload`
   * (the raw content itself: an article's full body, a test's questions, a video's script) to stay
   * lightweight for identity resolution ("the second lesson in that module"). This is the
   * counterpart for when a caller (the `get_course_lesson_content` AI tool, or `generate_lesson_content`/
   * `generate_assessment`'s own `execute()` reading the current state before proposing a change)
   * actually needs the full row. Same not-found-for-both-cases visibility rule as every other read
   * method here — a lesson's content is exactly as sensitive as the course it belongs to. */
  async getLessonContent(ctx: CourseServiceContext, contentItemId: string): Promise<CourseServiceResult<typeof contentItems.$inferSelect>> {
    const [existing] = await ctx.db.select().from(contentItems).where(eq(contentItems.id, contentItemId));
    if (!existing) {
      return fail("not_found", "Content item not found");
    }
    if (!(await isCourseVisibleToCaller(ctx, existing.courseId))) {
      return fail("not_found", "Content item not found");
    }
    return ok(existing);
  },

  /** Extracted verbatim from `POST /tenant/courses` — same required-field/enum validation, same
   * category auto-resolve-or-create, same "always created as draft" behavior. */
  async createCourse(ctx: CourseServiceContext, input: CreateCourseInput): Promise<CourseServiceResult<Awaited<ReturnType<typeof toResponseRows>>[number]>> {
    const validation = validateCreateCourseInput(input);
    if (validation) {
      return fail(validation.code, validation.message);
    }

    const category = await resolveOrCreateCourseCategory(ctx.db, ctx.tenantId, input.category!, ctx.userId);

    const [created] = await ctx.db
      .insert(courses)
      .values({
        tenantId: ctx.tenantId,
        title: input.title!.trim(),
        description: input.description ?? null,
        categoryId: category.id,
        deliveryMode: input.deliveryMode!,
        durationValue: input.duration!.value!,
        durationUnit: input.duration!.unit!,
        provider: input.provider ?? null,
        cost: input.cost ?? null,
        subcategory: input.subcategory ?? null,
        learningObjectives: input.learningObjectives ?? [],
        requirements: input.requirements ?? [],
        status: "draft",
        createdByUserId: ctx.userId,
      })
      .returning();

    const [data] = await toResponseRows(ctx.db, [created]);
    return ok(data);
  },

  /** Extracted verbatim from `POST /tenant/courses/:courseId/modules` — same append-on-create
   * position, same outlineOrder append. */
  async createModule(ctx: CourseServiceContext, courseId: string, input: CreateModuleInput): Promise<CourseServiceResult<typeof courseModules.$inferSelect>> {
    if (!input.title?.trim()) {
      return fail("missing_required", "title is required");
    }

    const [course] = await ctx.db.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId));
    if (!course) {
      return fail("not_found", "Course not found");
    }

    const existing = await ctx.db.select({ id: courseModules.id }).from(courseModules).where(eq(courseModules.courseId, courseId));

    const [created] = await ctx.db
      .insert(courseModules)
      .values({
        tenantId: ctx.tenantId,
        courseId,
        title: input.title.trim(),
        description: input.description ?? null,
        position: existing.length,
        createdByUserId: ctx.userId,
      })
      .returning();
    await ctx.db.update(courses).set({ outlineOrder: sql`array_append(${courses.outlineOrder}, ${created.id})` }).where(eq(courses.id, courseId));
    await revertToDraftIfPublished(ctx.db, courseId);

    return ok(created);
  },

  /** Extracted verbatim from `POST /tenant/modules/:moduleId/content-items` (module-scoped) and
   * `POST /tenant/courses/:courseId/content-items` (standalone, module-less) — one method covering
   * both, selected by whether `target.moduleId` is given, same type/payload validation, same
   * append-on-create position, same outlineOrder append for the standalone case only (a
   * module-scoped item is never listed in `outlineOrder`, exactly as those two routes already
   * differ). */
  async createLesson(
    ctx: CourseServiceContext,
    target: { courseId: string; moduleId?: string },
    input: CreateLessonInput,
  ): Promise<CourseServiceResult<typeof contentItems.$inferSelect>> {
    if (!input.type || !input.title?.trim()) {
      return fail("missing_required", "type and title are required");
    }
    if (!CONTENT_ITEM_TYPES.includes(input.type as ContentItemType)) {
      return fail("invalid", "Invalid type");
    }
    const payloadValidation = validateContentItemPayload(input.type as ContentItemType, input.payload);
    if (payloadValidation.error) {
      return fail("invalid", payloadValidation.error);
    }

    let courseId: string;
    let moduleId: string | null = null;
    if (target.moduleId) {
      const [module] = await ctx.db.select().from(courseModules).where(eq(courseModules.id, target.moduleId));
      if (!module) {
        return fail("not_found", "Module not found");
      }
      courseId = module.courseId;
      moduleId = target.moduleId;
    } else {
      const [course] = await ctx.db.select({ id: courses.id }).from(courses).where(eq(courses.id, target.courseId));
      if (!course) {
        return fail("not_found", "Course not found");
      }
      courseId = target.courseId;
    }

    const existing = moduleId
      ? await ctx.db.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.moduleId, moduleId))
      : await ctx.db.select({ id: contentItems.id }).from(contentItems).where(and(eq(contentItems.courseId, courseId), isNull(contentItems.moduleId)));

    const [created] = await ctx.db
      .insert(contentItems)
      .values({
        tenantId: ctx.tenantId,
        courseId,
        moduleId,
        type: input.type,
        title: input.title.trim(),
        description: input.description ?? null,
        payload: input.payload ?? {},
        position: existing.length,
        createdByUserId: ctx.userId,
      })
      .returning();

    if (!moduleId) {
      await ctx.db.update(courses).set({ outlineOrder: sql`array_append(${courses.outlineOrder}, ${created.id})` }).where(eq(courses.id, courseId));
    }
    await revertToDraftIfPublished(ctx.db, courseId);

    return ok(created);
  },

  /** Extracted verbatim from `PATCH /tenant/courses/:courseId` — same field-presence-based partial
   * update (`!== undefined`, never a full-object replace), same category auto-resolve-or-create,
   * same unrestricted EXPLICIT status transitions (an `input.status` always wins outright). When
   * `input.status` is omitted, though, editing any other field is itself Course Content
   * Draft-Reversion's trigger — see `revertToDraftIfPublished`'s own doc comment. Also covers
   * `PATCH /tenant/courses/:courseId/objectives`'s `learningObjectives`/`requirements` — see
   * `UpdateCourseInput`'s doc comment. */
  async updateCourse(ctx: CourseServiceContext, courseId: string, input: UpdateCourseInput): Promise<CourseServiceResult<Awaited<ReturnType<typeof toResponseRows>>[number]>> {
    const [existing] = await ctx.db.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId));
    if (!existing) {
      return fail("not_found", "Course not found");
    }

    const validation = validateUpdateCourseInput(input);
    if (validation) {
      return fail(validation.code, validation.message);
    }

    let categoryId: string | undefined;
    if (input.category !== undefined) {
      const category = await resolveOrCreateCourseCategory(ctx.db, ctx.tenantId, input.category, ctx.userId);
      categoryId = category.id;
    }

    const learningObjectives = input.learningObjectives?.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
    const requirements = input.requirements?.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);

    const [updated] = await ctx.db
      .update(courses)
      .set({
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(categoryId !== undefined ? { categoryId } : {}),
        ...(input.deliveryMode !== undefined ? { deliveryMode: input.deliveryMode } : {}),
        ...(input.duration?.value !== undefined ? { durationValue: input.duration.value } : {}),
        ...(input.duration?.unit !== undefined ? { durationUnit: input.duration.unit } : {}),
        ...(input.provider !== undefined ? { provider: input.provider } : {}),
        ...(input.cost !== undefined ? { cost: input.cost } : {}),
        ...(input.subcategory !== undefined ? { subcategory: input.subcategory } : {}),
        // An explicit status (e.g. the Publish/Unpublish action) always wins outright. Otherwise —
        // any other field being edited here (details or, via the objectives route, learningObjectives/
        // requirements) is a real content change: revert `active` → `draft` in the same statement via
        // a CASE, rather than a second round trip (see `revertToDraftIfPublished`'s own doc comment
        // for why this exists and what it's shared with).
        ...(input.status !== undefined
          ? { status: input.status }
          : { status: sql`case when ${courses.status} = 'active' then 'draft' else ${courses.status} end` }),
        ...(learningObjectives !== undefined ? { learningObjectives } : {}),
        ...(requirements !== undefined ? { requirements } : {}),
        updatedByUserId: ctx.userId,
        updatedAt: new Date(),
      })
      .where(eq(courses.id, courseId))
      .returning();

    const [data] = await toResponseRows(ctx.db, [updated]);
    return ok(data);
  },

  /** Extracted verbatim from `PATCH /tenant/modules/:moduleId` — same "title present but blank" 400,
   * same status-enum 422, same partial-update semantics. */
  async updateModule(ctx: CourseServiceContext, moduleId: string, input: UpdateModuleInput): Promise<CourseServiceResult<typeof courseModules.$inferSelect>> {
    const [existing] = await ctx.db.select().from(courseModules).where(eq(courseModules.id, moduleId));
    if (!existing) {
      return fail("not_found", "Module not found");
    }
    if (input.title !== undefined && !input.title.trim()) {
      return fail("missing_required", "title cannot be blank");
    }
    if (input.status !== undefined && !PUBLISH_STATUSES.includes(input.status)) {
      return fail("invalid", "Invalid status");
    }

    const [updated] = await ctx.db
      .update(courseModules)
      .set({
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedByUserId: ctx.userId,
        updatedAt: new Date(),
      })
      .where(eq(courseModules.id, moduleId))
      .returning();
    await revertToDraftIfPublished(ctx.db, existing.courseId);

    return ok(updated);
  },

  /** Extracted verbatim from `PATCH /tenant/content-items/:contentItemId` — minus the `type`-change
   * rejection (there's no `type` field on `UpdateLessonInput` to reject in the first place — see its
   * doc comment) and minus the `moduleId` move (same reason, out of scope this phase). Payload is
   * validated against the content item's EXISTING, immutable type — never a caller-supplied one —
   * via the exact same `validateContentItemPayload` `createLesson` and the original route both use. */
  async updateLesson(ctx: CourseServiceContext, contentItemId: string, input: UpdateLessonInput): Promise<CourseServiceResult<typeof contentItems.$inferSelect>> {
    const [existing] = await ctx.db.select().from(contentItems).where(eq(contentItems.id, contentItemId));
    if (!existing) {
      return fail("not_found", "Content item not found");
    }
    if (input.title !== undefined && !input.title.trim()) {
      return fail("missing_required", "title cannot be blank");
    }
    if (input.payload !== undefined) {
      const payloadValidation = validateContentItemPayload(existing.type as ContentItemType, input.payload);
      if (payloadValidation.error) {
        return fail("invalid", payloadValidation.error);
      }
    }
    if (input.status !== undefined && !PUBLISH_STATUSES.includes(input.status)) {
      return fail("invalid", "Invalid status");
    }

    const [updated] = await ctx.db
      .update(contentItems)
      .set({
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.payload !== undefined ? { payload: input.payload } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedByUserId: ctx.userId,
        updatedAt: new Date(),
      })
      .where(eq(contentItems.id, contentItemId))
      .returning();
    await revertToDraftIfPublished(ctx.db, existing.courseId);

    return ok(updated);
  },

  /** Extracted verbatim from `POST /tenant/courses/:courseId/modules/reorder` (Course Organization
   * AI Phase 1) — same exact-set-match validation (`moduleIds` must contain every one of the course's
   * *current* modules, no more, no fewer) before rewriting `position` to each id's index. This single
   * check is what rules out all of: a partial reorder silently dropping a module, a duplicate id
   * silently colliding two modules onto one position, and a foreign id from another course slipping
   * in (a cross-course id can never be a member of `current`, so it can never satisfy the match).
   * Same "invalid" error code as the route's own 422 (`sendCourseServiceError` maps it back to 422). */
  async reorderModules(ctx: CourseServiceContext, courseId: string, moduleIds: string[]): Promise<CourseServiceResult<(typeof courseModules.$inferSelect)[]>> {
    const [course] = await ctx.db.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId));
    if (!course) {
      return fail("not_found", "Course not found");
    }

    const current = await ctx.db.select({ id: courseModules.id }).from(courseModules).where(eq(courseModules.courseId, courseId));
    const currentIds = new Set(current.map((m) => m.id));
    const submittedIds = new Set(moduleIds);
    const exactMatch = moduleIds.length === current.length && moduleIds.every((id) => currentIds.has(id)) && current.every((m) => submittedIds.has(m.id));
    if (!exactMatch) {
      return fail("invalid", "moduleIds must exactly match the course's current module set");
    }

    for (let i = 0; i < moduleIds.length; i++) {
      await ctx.db.update(courseModules).set({ position: i }).where(eq(courseModules.id, moduleIds[i]));
    }
    await revertToDraftIfPublished(ctx.db, courseId);

    const reordered = await ctx.db.select().from(courseModules).where(eq(courseModules.courseId, courseId)).orderBy(courseModules.position);
    return ok(reordered);
  },

  /** Extracted verbatim from `POST /tenant/modules/:moduleId/content-items/reorder` (Course
   * Organization AI Phase 1) — same exact-set-match validation, scoped to one module's own
   * content items (never the whole course's, so a lesson from a different module can't be reordered
   * in here — see `reorderLessons`' AI tool doc comment for why that matters for "wrong parent"
   * safety). */
  async reorderLessons(ctx: CourseServiceContext, moduleId: string, contentItemIds: string[]): Promise<CourseServiceResult<(typeof contentItems.$inferSelect)[]>> {
    const [module] = await ctx.db.select({ id: courseModules.id, courseId: courseModules.courseId }).from(courseModules).where(eq(courseModules.id, moduleId));
    if (!module) {
      return fail("not_found", "Module not found");
    }

    const current = await ctx.db.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.moduleId, moduleId));
    const currentIds = new Set(current.map((c) => c.id));
    const submittedIds = new Set(contentItemIds);
    const exactMatch = contentItemIds.length === current.length && contentItemIds.every((id) => currentIds.has(id)) && current.every((c) => submittedIds.has(c.id));
    if (!exactMatch) {
      return fail("invalid", "contentItemIds must exactly match the module's current content-item set");
    }

    for (let i = 0; i < contentItemIds.length; i++) {
      await ctx.db.update(contentItems).set({ position: i }).where(eq(contentItems.id, contentItemIds[i]));
    }
    await revertToDraftIfPublished(ctx.db, module.courseId);

    const reordered = await ctx.db.select().from(contentItems).where(eq(contentItems.moduleId, moduleId)).orderBy(contentItems.position);
    return ok(reordered);
  },

  /** Course Organization AI Phase 1 — a thin, dedicated wrapper over `updateModule({status:
   * "archived"})`, not a parallel write path: reuses its not_found handling and its (now
   * three-valued, see `PUBLISH_STATUSES`) status validation verbatim. Archiving an already-archived
   * module is a plain no-op update, same "no restricted transition graph" precedent `COURSE_STATUSES`
   * already established at the course level — never rejected as an error. Never deletes the row;
   * fully reversible by any caller that can still set `status` back to `draft`/`published` through
   * the existing `PATCH /tenant/modules/:moduleId` route (this phase ships no `unarchive` AI tool,
   * per its own explicit 4-tool scope). */
  async archiveModule(ctx: CourseServiceContext, moduleId: string): Promise<CourseServiceResult<typeof courseModules.$inferSelect>> {
    return CourseService.updateModule(ctx, moduleId, { status: "archived" });
  },

  /** Course Organization AI Phase 1 — same reasoning as `archiveModule`, one level down: a thin
   * wrapper over `updateLesson({status: "archived"})`. Never touches `type`/`payload`/`moduleId`;
   * never deletes the row. */
  async archiveLesson(ctx: CourseServiceContext, contentItemId: string): Promise<CourseServiceResult<typeof contentItems.$inferSelect>> {
    return CourseService.updateLesson(ctx, contentItemId, { status: "archived" });
  },

  /**
   * AI Image Discovery & Course Asset Management Phase 1 — persists an AI-discovered image as a
   * course's image. Reuses the EXACT mechanism the existing manual course-image picker already
   * writes through (`file_attachments`, `entityType: "course"`) — the only difference is `kind:
   * "link"` (a hotlinked external URL) instead of `kind: "file"` (an uploaded object in R2), because
   * the one provider this phase supports (Unsplash) requires hotlinking, never re-hosting (see
   * `UnsplashProvider`'s own doc comment). `deleteAllAttachmentsForEntity` is the SAME "a course only
   * ever has one current image" cleanup the manual upload/reuse routes already call
   * (`attachments/tenant-attachment-routes.ts`) — imported and reused verbatim, not reimplemented.
   *
   * The delete-then-insert pair is wrapped in a manual SAVEPOINT, same precedent and same reasoning
   * as `generateCourseStructure`'s own doc comment above: `confirmToolExecution` catches whatever
   * `execute()` throws and records `status: "failed"`, which would otherwise leave the OLD image
   * deleted but no new one inserted if the insert itself failed partway through.
   */
  async setCourseImage(ctx: CourseServiceContext, courseId: string, candidate: ImageCandidate): Promise<CourseServiceResult<typeof fileAttachments.$inferSelect>> {
    const [course] = await ctx.db.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId));
    if (!course) {
      return fail("not_found", "Course not found");
    }

    await ctx.db.execute(sql`SAVEPOINT set_course_image`);
    try {
      await deleteAllAttachmentsForEntity(ctx.db, "course", courseId);
      const [created] = await ctx.db
        .insert(fileAttachments)
        .values({
          tenantId: ctx.tenantId,
          entityType: "course",
          entityId: courseId,
          kind: "link",
          fileName: candidate.title?.trim() || `Photo by ${candidate.author ?? "unknown"} on Unsplash`,
          url: candidate.imageUrl,
          status: "ready",
          createdByUserId: ctx.userId,
          metadata: buildImageAttachmentMetadata(candidate),
        })
        .returning();
      await revertToDraftIfPublished(ctx.db, courseId);
      await ctx.db.execute(sql`RELEASE SAVEPOINT set_course_image`);
      return ok(created);
    } catch (err) {
      await ctx.db.execute(sql`ROLLBACK TO SAVEPOINT set_course_image`);
      return fail("invalid", err instanceof Error ? err.message : "Failed to set course image");
    }
  },

  /**
   * Same mechanism as `setCourseImage`, but attaches to a lesson instead — `entityType:
   * "content_item"`, the SAME polymorphic slot the existing "Lesson Resources" attachments already
   * use (a `kind: "link"` content_item attachment is exactly what a manually-added external-URL
   * lesson resource already is; an AI-selected image is simply one more of those). Unlike
   * `setCourseImage`, a lesson can already have several OTHER resources — only prior AI-selected
   * IMAGES are replaced (matched via `metadata->>'provider'` being non-null), never a human-added
   * document/link resource, so this never silently deletes something the user attached manually.
   */
  async setLessonImage(ctx: CourseServiceContext, contentItemId: string, candidate: ImageCandidate): Promise<CourseServiceResult<typeof fileAttachments.$inferSelect>> {
    const [lesson] = await ctx.db.select({ id: contentItems.id, courseId: contentItems.courseId }).from(contentItems).where(eq(contentItems.id, contentItemId));
    if (!lesson) {
      return fail("not_found", "Lesson not found");
    }

    await ctx.db.execute(sql`SAVEPOINT set_lesson_image`);
    try {
      const priorAiImages = await ctx.db
        .select({ id: fileAttachments.id, storageKey: fileAttachments.storageKey })
        .from(fileAttachments)
        .where(and(eq(fileAttachments.entityType, "content_item"), eq(fileAttachments.entityId, contentItemId), sql`${fileAttachments.metadata} is not null`));
      if (priorAiImages.length > 0) {
        await ctx.db.delete(fileAttachments).where(inArray(fileAttachments.id, priorAiImages.map((r) => r.id)));
      }

      const [created] = await ctx.db
        .insert(fileAttachments)
        .values({
          tenantId: ctx.tenantId,
          entityType: "content_item",
          entityId: contentItemId,
          kind: "link",
          fileName: candidate.title?.trim() || `Photo by ${candidate.author ?? "unknown"} on Unsplash`,
          url: candidate.imageUrl,
          status: "ready",
          createdByUserId: ctx.userId,
          metadata: buildImageAttachmentMetadata(candidate),
        })
        .returning();
      await revertToDraftIfPublished(ctx.db, lesson.courseId);
      await ctx.db.execute(sql`RELEASE SAVEPOINT set_lesson_image`);
      return ok(created);
    } catch (err) {
      await ctx.db.execute(sql`ROLLBACK TO SAVEPOINT set_lesson_image`);
      return fail("invalid", err instanceof Error ? err.message : "Failed to set lesson image");
    }
  },

  /**
   * Course Generation Phase 1 — creates a whole course + its modules + their lessons in one atomic
   * operation, only ever called from `generate_course_structure`'s `execute()` (propose→confirm, so
   * this only ever runs once a human has already reviewed and confirmed the full plan).
   *
   * Atomicity (the task's own Phase 12, "failure safety"): audited this codebase's transaction model
   * before adding anything — `plugins/tenant-context.ts` already wraps EVERY request in one
   * `BEGIN`...`COMMIT`/`ROLLBACK` transaction end-to-end via a RAW `client.query("BEGIN")` (never
   * Drizzle's own `.transaction()`), which is exactly why no application code anywhere else in this
   * codebase calls `db.transaction()` — a single request's writes are already atomic by construction.
   * That guarantee has one specific hole for THIS method: `execution-state-machine.ts`'s
   * `confirmToolExecution` deliberately CATCHES whatever a tool's `execute()` throws and stores it as
   * a `status: "failed"` row instead of rethrowing (the right behavior for a single-write tool — one
   * failed mutation shouldn't turn into an opaque 500 for the whole HTTP request) — but that same
   * catch silently defeats the outer transaction's own rollback for a MULTI-insert tool like this one:
   * course + module 1 + module 2 committing while module 3's insert throws would otherwise leave two
   * orphaned modules attached to a course nobody confirmed creating that way.
   *
   * `ctx.db.transaction(...)` was tried first and is WRONG here — reverted after a real integration
   * test caught it, not just reasoned about: Drizzle's own `NodePgSession.transaction()` only issues
   * a `SAVEPOINT` when it's nested inside a transaction IT ITSELF already opened (tracked via its own
   * internal `nestedIndex`); since `ctx.db` is a fresh `drizzle(client)` handed a connection whose
   * transaction was opened by `tenant-context.ts`'s raw `client.query("BEGIN")` (Drizzle has no idea
   * that happened), calling `.transaction()` on it hits Drizzle's OUTERMOST code path — a second
   * `BEGIN` Postgres just ignores (already in a transaction block), so the callback keeps writing
   * into the very same real transaction, and a throw inside issues a plain `ROLLBACK` that wipes out
   * everything in the ENTIRE per-request transaction, not just this method's own inserts (confirmed
   * by reading `drizzle-orm/node-postgres/session.js` directly, then reproducing it with a real
   * induced-failure test before ever writing this comment).
   *
   * Fixed with a manual, raw-SQL Postgres `SAVEPOINT`/`ROLLBACK TO SAVEPOINT`/`RELEASE SAVEPOINT` via
   * `ctx.db.execute(sql\`...\`)` instead — a plain Postgres-level construct that works correctly
   * regardless of which layer (raw SQL or an ORM) opened the outer transaction, since it only ever
   * references the real underlying connection state, never an ORM's own bookkeeping. A throw between
   * `SAVEPOINT` and `RELEASE SAVEPOINT` rolls back only what this method itself wrote, leaves the
   * outer per-request transaction perfectly healthy, and then re-throws — which `confirmToolExecution`
   * catches exactly as designed, reporting `status: "failed"` with zero records left behind. Verified
   * with a real induced-failure integration test — see `ai-foundation-course-generation.test.ts`'s
   * "a raw SAVEPOINT rolls back everything written inside it..." case.
   */
  async generateCourseStructure(ctx: CourseServiceContext, plan: GenerateCourseStructureInput): Promise<CourseServiceResult<{ course: Awaited<ReturnType<typeof toResponseRows>>[number]; modules: { id: string; title: string; lessons: { id: string; title: string }[] }[] }>> {
    const courseValidation = validateCreateCourseInput({
      title: plan.title,
      category: plan.category,
      deliveryMode: plan.deliveryMode,
      duration: plan.duration,
      cost: plan.cost,
    });
    if (courseValidation) {
      return fail(courseValidation.code, courseValidation.message);
    }
    const planValidation = validateGenerationPlan(plan);
    if (planValidation) {
      return fail(planValidation.code, planValidation.message);
    }
    if ((plan.learningObjectives?.length ?? 0) > GENERATION_LIMITS.maxLearningObjectives) {
      return fail("invalid", `A generated course must have at most ${GENERATION_LIMITS.maxLearningObjectives} learning objectives.`);
    }
    if ((plan.requirements?.length ?? 0) > GENERATION_LIMITS.maxRequirements) {
      return fail("invalid", `A generated course must have at most ${GENERATION_LIMITS.maxRequirements} requirements.`);
    }

    const category = await resolveOrCreateCourseCategory(ctx.db, ctx.tenantId, plan.category!, ctx.userId);

    await ctx.db.execute(sql`SAVEPOINT generate_course_structure`);
    try {
      const [course] = await ctx.db
        .insert(courses)
        .values({
          tenantId: ctx.tenantId,
          title: plan.title!.trim(),
          description: plan.description ?? null,
          categoryId: category.id,
          deliveryMode: plan.deliveryMode!,
          durationValue: plan.duration!.value!,
          durationUnit: plan.duration!.unit!,
          provider: plan.provider ?? null,
          cost: plan.cost ?? null,
          subcategory: plan.subcategory ?? null,
          learningObjectives: plan.learningObjectives ?? [],
          requirements: plan.requirements ?? [],
          status: "draft",
          createdByUserId: ctx.userId,
        })
        .returning();

      const moduleResults: { id: string; title: string; lessons: { id: string; title: string }[] }[] = [];
      const moduleIds: string[] = [];
      for (let moduleIndex = 0; moduleIndex < plan.modules.length; moduleIndex++) {
        const moduleInput = plan.modules[moduleIndex];
        const [module] = await ctx.db
          .insert(courseModules)
          .values({
            tenantId: ctx.tenantId,
            courseId: course.id,
            title: moduleInput.title!.trim(),
            description: moduleInput.description ?? null,
            position: moduleIndex,
            createdByUserId: ctx.userId,
          })
          .returning();
        moduleIds.push(module.id);

        const lessonResults: { id: string; title: string }[] = [];
        for (let lessonIndex = 0; lessonIndex < moduleInput.lessons.length; lessonIndex++) {
          const lessonInput = moduleInput.lessons[lessonIndex];
          // `article` is the only content type whose payload validation can be satisfied without
          // fabricating a URL/schedule/external source (see this method's own doc comment and
          // `GenerateCourseStructureInput`'s). Prefers the lesson's own generated description as
          // the body (legitimate structural content the model already produced as part of the
          // plan) over an honest "not yet written" placeholder — never invented facts either way.
          const body = lessonInput.description?.trim() || `Content for "${lessonInput.title!.trim()}" has not been written yet.`;
          const [lesson] = await ctx.db
            .insert(contentItems)
            .values({
              tenantId: ctx.tenantId,
              courseId: course.id,
              moduleId: module.id,
              type: "article",
              title: lessonInput.title!.trim(),
              description: lessonInput.description ?? null,
              payload: { body },
              position: lessonIndex,
              createdByUserId: ctx.userId,
            })
            .returning();
          lessonResults.push({ id: lesson.id, title: lesson.title });
        }
        moduleResults.push({ id: module.id, title: module.title, lessons: lessonResults });
      }

      const [withOutline] = await ctx.db
        .update(courses)
        .set({ outlineOrder: moduleIds })
        .where(eq(courses.id, course.id))
        .returning();

      await ctx.db.execute(sql`RELEASE SAVEPOINT generate_course_structure`);

      const [courseRow] = await toResponseRows(ctx.db, [withOutline]);
      return ok({ course: courseRow, modules: moduleResults });
    } catch (err) {
      await ctx.db.execute(sql`ROLLBACK TO SAVEPOINT generate_course_structure`);
      return fail("invalid", err instanceof Error ? err.message : "Course generation failed");
    }
  },
};
