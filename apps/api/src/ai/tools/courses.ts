import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { registerTool } from "../tool-registry";
import type { ToolContext } from "../types";
import { CourseService, DELIVERY_MODES, DURATION_UNITS, GENERATION_LIMITS, validateGenerationPlan } from "../../courses/course-service";
import { validateAssessmentQuestions } from "../../course-content/content-item-payload-validation";

/**
 * AI Foundation Phase 3 — the Courses domain, the second AI vertical slice after Forms. Every tool
 * here wraps `CourseService` (`courses/course-service.ts`) — never touches Drizzle/Postgres
 * directly, exactly like `ai/tools/forms.ts` wraps `FormService`.
 *
 * Deliberately excludes anything to do with publishing or assigning a course — `create_course_draft`
 * always produces a `status: "draft"` course (`CourseService.createCourse` hardcodes this; there is
 * no way for a tool argument to override it), and there is no `publish_course`/`assign_course` tool
 * in this phase at all (explicitly out of scope — "Do NOT implement yet" in the Phase 3 plan).
 *
 * `get_course` deliberately does NOT carry a module summary (Course AI context/discoverability
 * hardening) — module discovery is `list_course_modules`, a separate tool, not an inline field.
 * Every registered tenant-scope tool is already sent to the model on every single turn
 * (`ai/routes.ts`'s `toolSpecs`), so a well-described dedicated tool is exactly as discoverable to
 * the model as an inline field would be — with none of the downside of paying a bigger response (and
 * token cost) on every plain "what's this course about" question, including the many times a turn
 * calls `get_course` just to re-orient itself (observed repeatedly in live testing) with no need for
 * module detail at all. A "lightweight" inline array also doesn't actually stay lightweight — it
 * still grows with the course's module count, which is exactly what the brief said to avoid.
 */

const deliveryModeSchema = z.enum(DELIVERY_MODES);
const durationUnitSchema = z.enum(DURATION_UNITS);

const listCoursesInput = z.object({
  search: z.string().optional().describe("Free-text search over course titles."),
  status: z.enum(["draft", "active", "archived"]).optional().describe("Filter by status. Omit to see draft/active courses (archived courses are hidden by default, matching the course catalog's own default view)."),
  category: z.string().uuid().optional().describe("Filter by category id (see the `category.id` field on a course returned from this same tool)."),
  deliveryMode: deliveryModeSchema.optional(),
});

registerTool({
  name: "list_courses",
  domain: "courses",
  resource: "course",
  operation: "list",
  description: "List the tenant's courses — optionally filtered by search text, status, category, or delivery mode. Respects the caller's own course visibility (a course.manage holder sees every course; anyone else only sees courses assigned to them, same as the course catalog page). Read-only.",
  inputSchema: listCoursesInput,
  requiredPermissions: [],
  mutating: false,
  requiresConfirmation: false,
  scope: "tenant",
  async execute(ctx: ToolContext, input) {
    const result = await CourseService.listCourses(ctx, input);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});

const getCourseInput = z.object({
  courseId: z.string().uuid().describe("The course's id — from list_courses, or from page context when the user is currently viewing a course."),
});

registerTool({
  name: "get_course",
  domain: "courses",
  resource: "course",
  operation: "get",
  description: "Get full details for one course by id, including its category, delivery mode, duration, learning objectives, requirements, and module count. Read-only.",
  inputSchema: getCourseInput,
  requiredPermissions: [],
  mutating: false,
  requiresConfirmation: false,
  scope: "tenant",
  async execute(ctx: ToolContext, input) {
    const result = await CourseService.getCourse(ctx, input.courseId);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});

const listCourseModulesInput = z.object({
  courseId: z.string().uuid().describe("The course to list modules for."),
});

registerTool({
  name: "list_course_modules",
  domain: "courses",
  resource: "module",
  operation: "list",
  description:
    "List a course's existing modules — id, title, description, position/order, status, and how many lessons each already has. Use this whenever the user refers to a module by name or description (e.g. \"the Recognizing Threats module\") — call it to resolve the reference to a real moduleId before calling create_course_lesson or update_course_module, rather than guessing. If more than one module could plausibly match what the user said, ask them which one they mean instead of picking one. Read-only.",
  inputSchema: listCourseModulesInput,
  requiredPermissions: [],
  mutating: false,
  requiresConfirmation: false,
  scope: "tenant",
  async execute(ctx: ToolContext, input) {
    const result = await CourseService.listModules(ctx, input.courseId);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});

const draftModuleInputSchema = z.object({
  title: z.string().describe("The module's title, e.g. \"Introduction to Cybersecurity\"."),
  description: z.string().optional().describe("One or two sentences on what this module covers."),
});

const createCourseDraftInput = z.object({
  title: z.string().describe("The course's title."),
  description: z.string().optional().describe("A short description of what the course covers."),
  category: z.string().describe("The course's category name, e.g. \"Compliance\" or \"Soft Skills\" — matched case-insensitively to an existing tenant category, or created if none matches. Never a category id."),
  deliveryMode: deliveryModeSchema.describe("How the course is delivered."),
  duration: z.object({ value: z.number().positive(), unit: durationUnitSchema }).describe("The course's total duration."),
  learningObjectives: z.array(z.string()).optional().describe("What a learner should be able to do after completing this course."),
  requirements: z.array(z.string()).optional().describe("Any prerequisites to take this course."),
  modules: z.array(draftModuleInputSchema).optional().describe("The course's top-level modules/sections, in order. Include a reasonable set (titles + one-line descriptions) whenever the user's request implies a structure (e.g. a topic, an audience, a module count) — omit only if there's truly nothing to structure yet."),
});

registerTool({
  name: "create_course_draft",
  domain: "courses",
  resource: "course",
  operation: "create",
  description:
    "Create a course shell — title, description, category, delivery mode, duration, learning objectives, and a bare list of module TITLES with no lessons in them — as an unpublished DRAFT pending human confirmation. PREFER generate_course_structure instead for almost every \"create a course about X\" request: it produces the same course-level fields PLUS each module's actual lessons, which is what a natural-language course request almost always implies. Only reach for this tool instead when the user explicitly wants just a bare module outline with no lesson content at all (e.g. \"just set up the modules, I'll add lessons myself\"). Every field must come from the real course schema (no invented fields); ground every generated value in what the user actually asked for, never fabricated specifics they didn't imply. This never publishes a course — it always creates status: draft, and never assigns it to anyone. Mutating — requires human confirmation.",
  inputSchema: createCourseDraftInput,
  requiredPermissions: ["course.manage"],
  mutating: true,
  requiresConfirmation: true,
  scope: "tenant",
  async execute(ctx: ToolContext, input) {
    const courseResult = await CourseService.createCourse(ctx, {
      title: input.title,
      description: input.description ?? null,
      category: input.category,
      deliveryMode: input.deliveryMode,
      duration: input.duration,
      learningObjectives: input.learningObjectives ?? [],
      requirements: input.requirements ?? [],
    });
    if (!courseResult.ok) throw new Error(courseResult.error.message);

    const modules: { id: string; title: string }[] = [];
    for (const module of input.modules ?? []) {
      const moduleResult = await CourseService.createModule(ctx, courseResult.data.id, { title: module.title, description: module.description ?? null });
      if (!moduleResult.ok) throw new Error(moduleResult.error.message);
      modules.push({ id: moduleResult.data.id, title: moduleResult.data.title });
    }

    return { course: courseResult.data, modules };
  },
});

const createCourseModuleInput = z.object({
  courseId: z.string().uuid().describe("The existing course to add this module to."),
  title: z.string().describe("The module's title."),
  description: z.string().optional(),
});

registerTool({
  name: "create_course_module",
  domain: "courses",
  resource: "module",
  operation: "create",
  description: "Add a NEW module (a top-level section) to an existing course — appended after its current modules. If the user wants to rename or otherwise edit an EXISTING module, use update_course_module instead — calling this on an existing module would create a duplicate, not edit it. Mutating — requires human confirmation.",
  inputSchema: createCourseModuleInput,
  requiredPermissions: ["course.manage"],
  mutating: true,
  requiresConfirmation: true,
  scope: "tenant",
  async execute(ctx: ToolContext, input) {
    const result = await CourseService.createModule(ctx, input.courseId, { title: input.title, description: input.description ?? null });
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});

/**
 * `create_course_lesson`'s payload requirements per content type, mirrored exactly from
 * `course-content/content-item-payload-validation.ts`'s `validateContentItemPayload` — the single
 * source of truth `CourseService.createLesson` itself validates against at confirm time regardless
 * of what this schema does (defense in depth; see this file's module doc comment). A per-type
 * `z.discriminatedUnion` was tried first and rejected: OpenAI's function-calling `parameters`
 * validator refuses any `oneOf`/`anyOf`/`allOf` at a tool's own top level ("schema must have type
 * 'object'... not have oneOf/anyOf/allOf/enum/const/not at the top level" — confirmed against the
 * real API, not a guess; see `zod-to-json-schema.ts`'s module doc comment). A flat object plus
 * `.superRefine()` below reaches the same goal — reject an invalid type/payload combination at
 * `tool.inputSchema.safeParse()`, before `invokeTool` ever creates a proposal row — through a JSON
 * Schema shape every provider accepts unmodified. The one thing lost versus a real discriminated
 * union is that the model can't read the field-per-type requirement structurally out of the JSON
 * Schema itself — it only sees it in this tool's `description` text (below) and `type`'s own
 * description, which is why both spell out every type's exact required fields explicitly.
 */
function validateLessonPayload(type: string, payload: Record<string, unknown> | undefined, ctx: z.RefinementCtx): void {
  const p = payload ?? {};
  const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ["payload"] });
  switch (type) {
    case "video":
      if (typeof p.url !== "string" || !p.url.trim()) fail("payload.url is required for video content");
      break;
    case "article":
      if ((typeof p.body !== "string" || !p.body.trim()) && (typeof p.externalUrl !== "string" || !p.externalUrl.trim())) {
        fail("payload.body or payload.externalUrl is required for article content");
      }
      break;
    case "live_class":
      if (typeof p.scheduledAt !== "string" || !p.scheduledAt.trim()) fail("payload.scheduledAt is required for live_class content");
      break;
    case "external_import":
      if (typeof p.url !== "string" || !p.url.trim()) fail("payload.url is required for external_import content");
      if (typeof p.sourceType !== "string" || !p.sourceType.trim()) fail("payload.sourceType is required for external_import content");
      break;
    // test/assignment: validateContentItemPayload requires nothing at all — the actual
    // question/task content is authored later in the course editor, not generated here.
  }
}

const createCourseLessonInput = z
  .object({
    courseId: z.string().uuid().describe("The course this lesson belongs to."),
    moduleId: z.string().uuid().optional().describe("The module to place this lesson in — resolve this via list_course_modules first if the user referred to the module by name. Omit only to add it as a standalone, top-level lesson not part of any module."),
    type: z
      .enum(["video", "article", "live_class", "test", "assignment", "external_import"])
      .describe(
        "The lesson's content type — each requires specific payload fields: video needs payload.url; article needs payload.body or payload.externalUrl; live_class needs payload.scheduledAt; external_import needs payload.url and payload.sourceType; test and assignment need no payload fields at all yet.",
      ),
    title: z.string(),
    description: z.string().optional(),
    payload: z
      .record(z.unknown())
      .optional()
      .describe("Type-specific content — see the `type` field's description above for exactly which keys are required for the chosen type."),
  })
  .superRefine((data, ctx) => validateLessonPayload(data.type, data.payload, ctx));

registerTool({
  name: "create_course_lesson",
  domain: "courses",
  resource: "lesson",
  operation: "create",
  description:
    "Add a NEW lesson (content item) to a course, either inside a specific module or as a standalone top-level lesson. Pick the content type that matches what the user actually asked for and supply exactly that type's required payload fields (video needs payload.url; article needs payload.body or payload.externalUrl; live_class needs payload.scheduledAt; external_import needs payload.url and payload.sourceType; test/assignment need no payload). If the user wants to rename, rewrite, or otherwise edit an EXISTING lesson (even one you just created and know the id of), use update_course_lesson instead — calling this on an existing lesson would create a duplicate, not edit it. Mutating — requires human confirmation.",
  inputSchema: createCourseLessonInput,
  requiredPermissions: ["course.manage"],
  mutating: true,
  requiresConfirmation: true,
  scope: "tenant",
  async execute(ctx: ToolContext, input) {
    const result = await CourseService.createLesson(ctx, { courseId: input.courseId, moduleId: input.moduleId }, { type: input.type, title: input.title, description: input.description ?? null, payload: input.payload });
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});

const listCourseLessonsInput = z.object({
  courseId: z.string().uuid().describe("The course to list lessons for."),
  moduleId: z.string().uuid().optional().describe("Narrow to one module's lessons — resolve this via list_course_modules first if the user referred to the module by name. Omit to list every lesson in the course (module-scoped and standalone alike, each row's own moduleId showing where it lives)."),
});

registerTool({
  name: "list_course_lessons",
  domain: "courses",
  resource: "lesson",
  operation: "list",
  description:
    "List a course's (or one module's) existing lessons — id, title, description, content type, status, position/order, and which module each belongs to (null for a standalone lesson). Use this to resolve a natural-language lesson reference (e.g. \"the Phishing Basics lesson,\" \"the second lesson in that module\") into a real lessonId before calling update_course_lesson, rather than guessing. If more than one lesson could plausibly match what the user said, ask them which one they mean instead of picking one. Read-only.",
  inputSchema: listCourseLessonsInput,
  requiredPermissions: [],
  mutating: false,
  requiresConfirmation: false,
  scope: "tenant",
  async execute(ctx: ToolContext, input) {
    const result = await CourseService.listLessons(ctx, input.courseId, input.moduleId);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});

/**
 * The three update tools below (AI Course Editing Phase 1) share one shape of restraint: each input
 * schema only ever includes the fields `CourseService`'s corresponding update method actually
 * accepts from the AI's side — deliberately narrower than what the method (and the underlying HTTP
 * route) supports for a human using the real editor. Two fields are excluded from all three, on
 * purpose, not by oversight:
 *
 * - `status` — every one of courses/modules/lessons has a status field the real HTTP routes CAN
 *   change (including a course's draft → active transition — "no restricted transition graph," per
 *   `tenant-course-routes.ts`'s own doc comment). None of these AI tools expose it. "The AI must not
 *   implicitly publish or activate anything" (Tool Selection & Scope Guardrails phase, extended here)
 *   — an admin asking to "update the title" must never have a side effect of publishing anything.
 * - a lesson's `moduleId`/`type` — moving a lesson between modules has outline-order side effects
 *   genuinely close to "reorder" (out of scope this phase); `type` is immutable at the business-rule
 *   level regardless (enforced in `CourseService.updateLesson` itself, not just here).
 *
 * Every one of these is `requiresConfirmation: true` — the model only ever proposes; a human decides.
 * `ProposalCard` (apps/web) renders each proposal's fields directly from `execution.input` — the
 * exact arguments the model called with, nothing else — so it can only ever show what's actually
 * about to change, never a fabricated "current value" (see that file's own comment on why no
 * before/after diff is shown pre-confirmation: this architecture only fetches "before" state at
 * confirm time, inside `execute()`, which never runs before a human confirms — showing an old value
 * captured any earlier would risk showing stale data, so it isn't shown at all rather than guessed).
 */

const updateCourseInput = z
  .object({
    courseId: z.string().uuid().describe("The course to update."),
    title: z.string().optional(),
    description: z.string().nullable().optional(),
    category: z.string().optional().describe("New category name — matched case-insensitively to an existing tenant category, or created if none matches. Never a category id."),
    deliveryMode: deliveryModeSchema.optional(),
    duration: z.object({ value: z.number().positive(), unit: durationUnitSchema }).optional().describe("New total duration — give both value and unit together."),
    provider: z.string().nullable().optional(),
    cost: z.number().nullable().optional(),
    subcategory: z.string().nullable().optional(),
    learningObjectives: z.array(z.string()).optional(),
    requirements: z.array(z.string()).optional(),
  })
  .refine((data) => Object.entries(data).some(([key, value]) => key !== "courseId" && value !== undefined), { message: "At least one field to update must be provided" });

registerTool({
  name: "update_course",
  domain: "courses",
  resource: "course",
  operation: "update",
  description:
    "Update one or more fields on an EXISTING course — title, description, category, delivery mode, duration, provider, cost, subcategory, learning objectives, or requirements. Only include the fields actually changing (a partial update, not a full replace) — never restate fields the user didn't ask to change. Applies only to course-level properties, never modules or lessons within it. Cannot change the course's draft/active/archived status — there is no publish/activate capability here. Mutating — requires human confirmation.",
  inputSchema: updateCourseInput,
  requiredPermissions: ["course.manage"],
  mutating: true,
  requiresConfirmation: true,
  scope: "tenant",
  async execute(ctx: ToolContext, input) {
    const { courseId, ...fields } = input;
    const result = await CourseService.updateCourse(ctx, courseId, fields);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});

const updateCourseModuleInput = z
  .object({
    moduleId: z.string().uuid().describe("The module to update — resolve this via list_course_modules first if the user referred to it by name."),
    title: z.string().optional(),
    description: z.string().nullable().optional(),
  })
  .refine((data) => data.title !== undefined || data.description !== undefined, { message: "At least one field to update must be provided" });

registerTool({
  name: "update_course_module",
  domain: "courses",
  resource: "module",
  operation: "update",
  description:
    "Update the title and/or description of an EXISTING course module. Only include the fields actually changing. Applies only to the module itself, never the parent course or the lessons/content items inside it. Cannot change the module's draft/published status. Mutating — requires human confirmation.",
  inputSchema: updateCourseModuleInput,
  requiredPermissions: ["course.manage"],
  mutating: true,
  requiresConfirmation: true,
  scope: "tenant",
  async execute(ctx: ToolContext, input) {
    const result = await CourseService.updateModule(ctx, input.moduleId, { title: input.title, description: input.description });
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});

const updateCourseLessonInput = z
  .object({
    lessonId: z.string().uuid().describe("The lesson (content item) to update — resolve this via list_course_lessons first if the user referred to it by name, position (\"the second lesson\"), or any other natural-language reference rather than giving you its id directly."),
    title: z.string().optional(),
    description: z.string().nullable().optional(),
    payload: z
      .record(z.unknown())
      .optional()
      .describe("Type-specific content, validated against the lesson's EXISTING content type (which cannot itself be changed) — e.g. for an article, payload.body or payload.externalUrl."),
  })
  .refine((data) => data.title !== undefined || data.description !== undefined || data.payload !== undefined, { message: "At least one field to update must be provided" });

registerTool({
  name: "update_course_lesson",
  domain: "courses",
  resource: "lesson",
  operation: "update",
  description:
    "Update the title, description, and/or content (payload) of an EXISTING lesson with an EXACT value the human dictated or pasted — e.g. \"rename this lesson to X\", \"set the description to Y\", or the user gives you the literal replacement text themselves. Do NOT use this to write new educational content for an article/video/live_class lesson (a request like \"add content to this lesson\", \"expand this lesson\", or \"write an introduction for this lesson\") — that is generate_lesson_content's job specifically, which knows how to generate and validate substantive content grounded in the lesson's real type; this tool's payload field accepts anything and won't stop you from saving something malformed or thin. Only include the fields actually changing. The lesson's content type cannot be changed (create a new lesson instead if the user wants a different type), and this tool cannot move a lesson to a different module — say that isn't supported yet if asked. Cannot change the lesson's draft/published status. Mutating — requires human confirmation.",
  inputSchema: updateCourseLessonInput,
  requiredPermissions: ["course.manage"],
  mutating: true,
  requiresConfirmation: true,
  scope: "tenant",
  async execute(ctx: ToolContext, input) {
    const result = await CourseService.updateLesson(ctx, input.lessonId, { title: input.title, description: input.description, payload: input.payload });
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});

/**
 * The four tools below (Course Organization AI Phase 1) cover reordering and archiving — never
 * publishing/activating, deleting, assigning, or moving a lesson between modules, all explicitly out
 * of scope.
 *
 * Reorder tools take the COMPLETE new order, not a "move X to position N" instruction — the same
 * contract `CourseService.reorderModules`/`reorderLessons` already exposes to
 * `POST .../modules/reorder`/`POST .../content-items/reorder` (this phase's own extraction of those
 * routes' existing logic, unchanged). This pushes "what does the full resulting order look like" onto
 * the model, which is well-positioned to compute it (it just called `list_course_modules`/
 * `list_course_lessons` and has the current order in hand) — and `CourseService` independently
 * re-verifies the submitted list is an exact-set match against what's actually in the database before
 * writing anything (never a partial list, a duplicate, or a foreign id from another course/module),
 * exactly the same defense-in-depth relationship `create_course_lesson`'s payload validation already
 * has with `validateContentItemPayload`. Never trust a model-supplied id list blindly — this is that
 * verification, not a suggestion.
 *
 * `reorder_course_lessons` is scoped to exactly one module's own lessons (mirrors
 * `CourseService.reorderLessons`'s own `moduleId` scoping) — it has no field through which a lesson
 * could ever move to a different module, so "move this lesson from Module A to Module B" cannot
 * happen through this tool even by mistake, not just by convention. Its description tells the model
 * outright that cross-module movement isn't supported, so the existing SYSTEM_PROMPT tool-selection
 * discipline (never substitute a wrong-but-similar tool) declines the request in plain text instead
 * of calling this tool with a foreign lesson id (which `CourseService` would reject anyway, but the
 * correct behavior is to never try).
 *
 * Archive tools set the module/lesson's existing `status` column to the new `archived` value
 * (`PublishStatus`, migration 0123) — a plain, reversible status change, identical in kind to the
 * course-level draft/active/archived toggle that already existed. Nothing is deleted; nothing about a
 * module's lessons or a course's other modules changes. There is deliberately no `unarchive_*` tool
 * this phase (not in the 4-tool scope) — reversal happens through the existing course editor once its
 * UI is updated to show the third status, or directly through `PATCH /tenant/modules/:moduleId` /
 * `PATCH /tenant/content-items/:contentItemId`, both of which already accept `status: "archived"` (or
 * back) via `CourseService.updateModule`/`updateLesson`'s own unrestricted status transitions.
 */

/** Every entry needs its real title alongside its id — not for `CourseService` (which only ever
 * reads `.id`; position is purely the array index) but for `ProposalCard`, which can only ever render
 * `execution.input` (never a fabricated "before" value, same rule the update tools' proposals follow)
 * and would otherwise have nothing but opaque UUIDs to show a human reviewing the proposal. The model
 * already has every title fresh from the `list_course_modules`/`list_course_lessons` call this tool's
 * own description requires calling first — echoing it back here costs nothing extra. `title` is
 * purely cosmetic and never influences the write; a wrong title here would misdescribe the proposal
 * to the reviewer (a bounded, human-visible display problem, not a security or data-integrity one —
 * the actual mutation only ever runs after that same human confirms it). */
const orderedResourceRef = z.object({ id: z.string().uuid(), title: z.string() });

const reorderCourseModulesInput = z.object({
  courseId: z.string().uuid().describe("The course whose modules are being reordered."),
  modules: z
    .array(orderedResourceRef)
    .min(1)
    .describe(
      "The COMPLETE new module order for this course — every existing module's {id, title}, exactly once, not just the ones that moved, in the new sequence. Call list_course_modules first to see the current order and every module's real id/title, then construct the full new sequence yourself (e.g. moving one module to a new position means placing it in the new spot while keeping every other module's relative order). A list that omits a module, repeats one, or includes an id from another course is rejected and nothing changes.",
    ),
});

registerTool({
  name: "reorder_course_modules",
  domain: "courses",
  resource: "module",
  operation: "reorder",
  description:
    "Reorder an existing course's modules into a new sequence — e.g. moving one module earlier or later, or to the front/back. Requires the COMPLETE new order (every module's id and title), not just the module that moved; call list_course_modules first if you don't already know every module's id and current position. Never invent an id. Mutating — requires human confirmation.",
  inputSchema: reorderCourseModulesInput,
  requiredPermissions: ["course.manage"],
  mutating: true,
  requiresConfirmation: true,
  scope: "tenant",
  async execute(ctx: ToolContext, input) {
    const result = await CourseService.reorderModules(ctx, input.courseId, input.modules.map((m: { id: string }) => m.id));
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});

const reorderCourseLessonsInput = z.object({
  moduleId: z.string().uuid().describe("The module whose lessons are being reordered — resolve this via list_course_modules first if the user referred to it by name."),
  lessons: z
    .array(orderedResourceRef)
    .min(1)
    .describe(
      "The COMPLETE new lesson order for THIS module only — every one of its existing lessons' {id, title}, exactly once, not just the one that moved, and never a lesson belonging to a different module, in the new sequence. Call list_course_lessons first (with this moduleId) to see the current order and every lesson's real id/title, then construct the full new sequence yourself. This tool only reorders lessons WITHIN one module — it cannot move a lesson into a different module.",
    ),
});

registerTool({
  name: "reorder_course_lessons",
  domain: "courses",
  resource: "lesson",
  operation: "reorder",
  description:
    "Reorder the lessons within an existing module into a new sequence. Requires the COMPLETE new order (every lesson's id and title in that module), not just the lesson that moved; call list_course_lessons first if you don't already know every lesson's id and current position in that module. This tool only reorders lessons WITHIN one module — it CANNOT move a lesson to a different module; there is no supported way to do that yet, so if the user asks to move a lesson between modules, say that isn't supported rather than calling this tool. Never invent an id. Mutating — requires human confirmation.",
  inputSchema: reorderCourseLessonsInput,
  requiredPermissions: ["course.manage"],
  mutating: true,
  requiresConfirmation: true,
  scope: "tenant",
  async execute(ctx: ToolContext, input) {
    const result = await CourseService.reorderLessons(ctx, input.moduleId, input.lessons.map((l: { id: string }) => l.id));
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});

const archiveCourseModuleInput = z.object({
  moduleId: z.string().uuid().describe("The module to archive — resolve this via list_course_modules first if the user referred to it by name."),
  title: z.string().describe("The module's current title, exactly as returned by list_course_modules — shown to the human reviewing this proposal so they can confirm it's the right module. Purely for display; never used for the actual archive operation."),
});

registerTool({
  name: "archive_course_module",
  domain: "courses",
  resource: "module",
  operation: "archive",
  description:
    "Archive an existing course module — a reversible status change, not a deletion. The module and its lessons stay in the database and can be restored later; nothing about them is removed, and this never touches ordering. Use this when the user wants to archive, hide, or retire an outdated or no-longer-needed module. Requires the module's id AND its current title (from list_course_modules), so the confirmation proposal can show the human which module by name, not just an id. Mutating — requires human confirmation.",
  inputSchema: archiveCourseModuleInput,
  requiredPermissions: ["course.manage"],
  mutating: true,
  requiresConfirmation: true,
  scope: "tenant",
  async execute(ctx: ToolContext, input) {
    const result = await CourseService.archiveModule(ctx, input.moduleId);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});

const archiveCourseLessonInput = z.object({
  lessonId: z.string().uuid().describe("The lesson (content item) to archive — resolve this via list_course_lessons first if the user referred to it by name, position, or any other natural-language reference."),
  title: z.string().describe("The lesson's current title, exactly as returned by list_course_lessons — shown to the human reviewing this proposal so they can confirm it's the right lesson. Purely for display; never used for the actual archive operation."),
});

registerTool({
  name: "archive_course_lesson",
  domain: "courses",
  resource: "lesson",
  operation: "archive",
  description:
    "Archive an existing lesson (content item) — a reversible status change, not a deletion. The lesson stays in the database and can be restored later; nothing about its content is removed, and this never touches ordering. Use this when the user wants to archive, hide, or retire an outdated or no-longer-needed lesson. Requires the lesson's id AND its current title (from list_course_lessons), so the confirmation proposal can show the human which lesson by name, not just an id. Mutating — requires human confirmation.",
  inputSchema: archiveCourseLessonInput,
  requiredPermissions: ["course.manage"],
  mutating: true,
  requiresConfirmation: true,
  scope: "tenant",
  async execute(ctx: ToolContext, input) {
    const result = await CourseService.archiveLesson(ctx, input.lessonId);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});

/**
 * Course Generation Phase 1 — `generate_course_structure` proposes a WHOLE NEW course (metadata +
 * modules + lessons) from one natural-language request, as a single reviewable proposal — never a
 * `create_course_draft` → `create_course_module` → `create_course_lesson` chain of separate,
 * separately-confirmed calls. `CourseService.generateCourseStructure` is the only place that ever
 * writes anything, and only at confirm time, inside one Postgres savepoint (see that method's own
 * doc comment on why a plain per-request transaction alone wasn't enough here).
 *
 * No `courseId`/`context` field exists anywhere in this schema — structurally, not just by
 * convention, this tool can only ever create a new course, never touch an existing one, so a
 * `context.courseId` hint from `buildSystemPrompt` can bias what the model TALKS about but has no
 * field to land in here even if it tried (Course Generation Phase 1's own "existing course context
 * safety" requirement, satisfied by the schema's shape rather than a runtime check).
 *
 * Every generated lesson is hardcoded to `type: "article"` — the only content type whose payload
 * validation (`content-item-payload-validation.ts`) can be satisfied without fabricating a video
 * URL, a live-class schedule, or an external source. Its `payload.body` prefers the lesson's own
 * generated `description` (legitimate structural content, already grounded in the user's request)
 * over an honest, clearly-labeled "not yet written" placeholder — never invented facts either way.
 */
const generateLessonInput = z.object({
  title: z.string().max(150).describe("The lesson's title."),
  description: z.string().max(500).optional().describe("One or two sentences summarizing what this lesson covers — becomes the lesson's initial placeholder content (payload.body) if given; otherwise an honest 'not yet written' placeholder is used instead. Ground this in the module/course topic — never invent specific facts, statistics, or claims."),
});

const generateModuleInput = z.object({
  title: z.string().max(150).describe("The module's title."),
  description: z.string().max(500).optional().describe("One or two sentences on what this module covers."),
  lessons: z
    .array(generateLessonInput)
    .min(GENERATION_LIMITS.minLessonsPerModule)
    .max(GENERATION_LIMITS.maxLessonsPerModule)
    .describe(`This module's lessons, in order — between ${GENERATION_LIMITS.minLessonsPerModule} and ${GENERATION_LIMITS.maxLessonsPerModule}.`),
});

const generateCourseStructureInput = z
  .object({
    title: z.string().max(200).describe("The course's title."),
    description: z.string().max(2000).optional().describe("A short description of what the course covers."),
    category: z.string().describe("The course's category name, e.g. \"Compliance\" or \"Soft Skills\" — matched case-insensitively to an existing tenant category, or created if none matches. Never a category id."),
    deliveryMode: deliveryModeSchema.describe("How the course is delivered."),
    duration: z.object({ value: z.number().positive(), unit: durationUnitSchema }).describe("The course's total duration."),
    provider: z.string().max(200).optional().describe("Only include if the user explicitly named a specific provider/vendor — never invent one."),
    cost: z.number().min(0).optional().describe("Only include if the user explicitly stated a cost — never invent one."),
    subcategory: z.string().max(200).optional(),
    learningObjectives: z.array(z.string().max(300)).max(GENERATION_LIMITS.maxLearningObjectives).optional().describe("What a learner should be able to do after completing this course."),
    requirements: z.array(z.string().max(300)).max(GENERATION_LIMITS.maxRequirements).optional().describe("Any prerequisites to take this course."),
    modules: z
      .array(generateModuleInput)
      .min(GENERATION_LIMITS.minModules)
      .max(GENERATION_LIMITS.maxModules)
      .describe(
        `The course's complete module structure, in order — between ${GENERATION_LIMITS.minModules} and ${GENERATION_LIMITS.maxModules} modules, each with its own lessons. If the user's request implies a larger structure than this allows (e.g. "12 modules"), do not silently truncate it — tell them the limit and ask if a smaller course is fine, or suggest splitting the topic, rather than calling this tool with a request-exceeding plan.`,
      ),
  })
  .superRefine((data, ctx) => {
    const validation = validateGenerationPlan(data);
    if (validation) ctx.addIssue({ code: z.ZodIssueCode.custom, message: validation.message, path: ["modules"] });
  });

registerTool({
  name: "generate_course_structure",
  domain: "courses",
  resource: "course",
  operation: "generate",
  description:
    `THE DEFAULT tool for "create a course about X" / "build a course covering Y and Z" / any request for an entirely NEW course — generates a COMPLETE course (metadata, modules, AND each module's own lessons) as one single reviewable proposal. Prefer this over create_course_draft for virtually every new-course request, since a natural-language course request almost always implies real lesson content, not just bare module titles — only fall back to create_course_draft if the user explicitly wants just a module outline with no lessons at all. Do NOT use this to add modules or lessons to an EXISTING course, or to rebuild/replace one — use create_course_module/create_course_lesson for adding to an existing course, and if the user says something ambiguous like "rebuild this course," ask what they mean rather than assuming this tool applies. Every module needs at least one lesson (${GENERATION_LIMITS.minLessonsPerModule}-${GENERATION_LIMITS.maxLessonsPerModule} per module, ${GENERATION_LIMITS.minModules}-${GENERATION_LIMITS.maxModules} modules total) — if the request doesn't give you enough to work with (no topic/subject at all), ask a concise clarifying question instead of generating something arbitrary; otherwise use sensible judgment to fill in a coherent structure without over-interrogating the user. Ground every generated title, description, and objective in what the user actually asked for — never invent a cost, provider, or specific fact they didn't state or imply. The course is always created as an unpublished DRAFT (never active/published), and nothing is written to the database until the human reviewing this proposal explicitly confirms. Mutating — requires human confirmation.`,
  inputSchema: generateCourseStructureInput,
  requiredPermissions: ["course.manage"],
  mutating: true,
  requiresConfirmation: true,
  scope: "tenant",
  summarizeProposal(input) {
    const lines: string[] = [
      `Proposed course: "${input.title}"`,
      `Category: ${input.category} · Delivery: ${input.deliveryMode} · Duration: ${input.duration.value} ${input.duration.unit}`,
    ];
    if (input.learningObjectives?.length) lines.push(`Learning objectives: ${input.learningObjectives.join("; ")}`);
    if (input.requirements?.length) lines.push(`Requirements: ${input.requirements.join("; ")}`);
    lines.push("Modules:");
    input.modules.forEach((module: { title: string; lessons: { title: string }[] }, moduleIndex: number) => {
      lines.push(`${moduleIndex + 1}. ${module.title}`);
      module.lessons.forEach((lesson: { title: string }, lessonIndex: number) => lines.push(`   ${moduleIndex + 1}.${lessonIndex + 1} ${lesson.title}`));
    });
    return lines.join("\n");
  },
  async execute(ctx: ToolContext, input) {
    const result = await CourseService.generateCourseStructure(ctx, input);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});

/**
 * AI Lesson Content & Assessment Generation phase. Phase 0 audit findings, in order:
 *
 * - `article`'s payload has exactly one required field (`body`, plain text) — fully, honestly
 *   generatable from scratch. No conflict.
 * - `video` requires a real `url`; `live_class` requires a real `scheduledAt` — both real-world
 *   facts, not something the AI should ever fabricate ("do not generate or upload an actual video
 *   file" — the same reasoning extends to inventing a fake url or a fake scheduled time). Resolved
 *   WITHOUT a schema change: `generate_lesson_content` only ever UPDATES an existing lesson (never
 *   creates a video/live_class lesson from scratch) and adds `script`/`agenda` as new, purely
 *   additive payload keys alongside the human-supplied, untouched `url`/`scheduledAt` — enforced in
 *   `execute()` below, not just described in prose.
 * - `test`/`assignment` had NO question/answer model at all — confirmed by reading the actual manual
 *   editor (`test-assignment-form.tsx`), an explicit "placeholder-shell" that always saves
 *   `payload: {}}`, with real content meant to be a File Attachment (an unstructured document)
 *   instead. This is a genuine architectural gap, not resolvable without a decision — surfaced to
 *   the user rather than guessed. Decision: add a `payload.questions` structure, validated in
 *   `content-item-payload-validation.ts` (same jsonb column, no database migration; `{}` stays fully
 *   valid). See that file's own doc comment for the exact shape and the "existing manual editor
 *   doesn't render this yet" gap this deliberately leaves open rather than also redesigning that UI
 *   (out of this phase's scope).
 *
 * Both new mutating tools below reuse `CourseService.createLesson`/`updateLesson` verbatim — no new
 * write method was needed. AI tools still never touch Drizzle directly.
 */

const getCourseLessonContentInput = z.object({
  lessonId: z.string().uuid().describe("The lesson (content item) to fetch — resolve this via list_course_lessons first if the user referred to it by name, position, or any other natural-language reference."),
});

registerTool({
  name: "get_course_lesson_content",
  domain: "courses",
  resource: "lesson",
  operation: "get",
  description:
    "Get a lesson's full content — type, title, description, and complete payload (an article's body; a video's script/url; a live_class's agenda/scheduledAt; a test/assignment's questions, if any exist yet). Use this before generating or regenerating a lesson's content, or before generating a quiz FROM a lesson's existing material, so new content is grounded in what's actually there rather than guessed. Read-only.",
  inputSchema: getCourseLessonContentInput,
  requiredPermissions: [],
  mutating: false,
  requiresConfirmation: false,
  scope: "tenant",
  async execute(ctx: ToolContext, input) {
    const result = await CourseService.getLessonContent(ctx, input.lessonId);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});

/**
 * Lesson Content Reliability Fix — a real, reproduced-and-logged live failure (not a guess): asked to
 * "include clear content for all the article lessons," the model called this tool with a fully
 * correct `lessonId`/`title`/`description`/`tone` but NO `articleBody` at all, tripping the
 * `.refine()` below. It did this consistently, on retry, whenever the request implied MULTIPLE
 * lessons at once — never for a single-lesson request, where it reliably included a full
 * `articleBody`. Root cause: the model was treating a multi-lesson request as something it could
 * plan across several tool calls in one breath (e.g. "send the easy metadata now, fill in the real
 * content next"), not realizing (a) only ONE tool call is ever acted on per turn (`ai/routes.ts`
 * takes `result.toolCalls[0]` only) and (b) this tool has no "draft now, fill in content later" mode
 * — the content field IS the entire point of calling it. Fixed two ways, not by loosening validation:
 *   1. The content fields are declared FIRST in the schema (models weight earlier-declared
 *      properties more heavily when deciding what to fill in) and every description below repeats,
 *      in different words, that the complete text must be written in THIS call, never deferred.
 *   2. The tool's own top-level description now explicitly tells the model how to handle a
 *      multi-lesson request: one lesson, one full-content call, per turn — never a "metadata-only"
 *      placeholder call, and never an attempt to batch several lessons into one response (only the
 *      first tool call a model returns is ever used; the rest are silently unusable, so trying to plan
 *      several at once produces nothing but a wasted, likely-invalid first call).
 */
const generateLessonContentInput = z
  .object({
    lessonId: z.string().uuid().describe("The EXISTING lesson to generate or regenerate content for — resolve this via list_course_lessons/get_course_lesson_content first. This tool only works on a lesson that already exists (created via create_course_lesson or generate_course_structure); it never creates a new lesson itself."),
    articleBody: z
      .string()
      .max(20000)
      .optional()
      .describe(
        "REQUIRED, and must be the COMPLETE generated content, if the lesson's existing type is article — never send this call without it, and never leave it blank/short/placeholder text intending to fill it in on a later call (there is no later call for this same proposal). One well-structured markdown body: learning objectives, key concepts, examples, a summary, and key takeaways as SECTIONS within this one text — there are no separate fields for them.",
      ),
    videoScript: z
      .string()
      .max(20000)
      .optional()
      .describe(
        "REQUIRED, and must be the COMPLETE generated script/transcript, if the lesson's existing type is video — never send this call without it. Structured markdown: sections/scenes, key points, a summary. This lesson must already have a real video url (check with get_course_lesson_content first) — this never creates or invents one; it only adds the textual script alongside the existing url.",
      ),
    liveClassAgenda: z
      .string()
      .max(10000)
      .optional()
      .describe(
        "REQUIRED, and must be the COMPLETE generated agenda, if the lesson's existing type is live_class — never send this call without it. Structured markdown: agenda, preparation requirements, discussion topics. This lesson must already have a real scheduledAt (check with get_course_lesson_content first) — this never creates or invents one; it only adds supporting text alongside the existing schedule.",
      ),
    lessonTitle: z.string().max(200).describe("The lesson's CURRENT title, exactly as returned by list_course_lessons/get_course_lesson_content — shown to the human reviewing this proposal so they can confirm it's the right lesson. Purely for display; never used to resolve the lesson (lessonId is)."),
    title: z.string().max(200).optional().describe("A revised title, only if it should change."),
    description: z.string().max(500).optional().describe("A revised one-line description, only if it should change."),
    audience: z.string().max(200).optional().describe("Who this content is for, e.g. \"new employees\" — only if the user specified or clearly implied one. Shown on the proposal for transparency; ground the generated content in it."),
    difficulty: z.enum(["beginner", "intermediate", "advanced"]).optional(),
    tone: z.string().max(100).optional().describe("e.g. \"formal\", \"conversational\" — only if the user specified one."),
    instructions: z.string().max(1000).optional().describe("Free-text guidance for THIS generation specifically, e.g. \"make it shorter\", \"add more examples\", \"focus on phishing\"."),
  })
  .refine((data) => [data.articleBody, data.videoScript, data.liveClassAgenda].filter((v) => v !== undefined).length === 1, {
    message:
      "You must give exactly ONE of articleBody, videoScript, or liveClassAgenda — whichever matches the lesson's own existing type — and it must contain the complete generated content, not a placeholder. This call had zero or more than one of those three fields set. If you are generating content for several lessons, call this tool again for the NEXT lesson in a following turn — never try to cover multiple lessons in one call, and never omit the content field intending to add it later.",
    path: ["articleBody"],
  });

registerTool({
  name: "generate_lesson_content",
  domain: "courses",
  resource: "lesson",
  operation: "generate",
  description:
    "Generate or regenerate the actual educational content of an EXISTING article, video, or live_class lesson — the real body/script/agenda, not just a title. Always reads the lesson's current type and content first; propose exactly the ONE content field matching that type (articleBody / videoScript / liveClassAgenda), and that field must contain the FULL generated text in this same call — never send this tool without it, and never split the content across multiple calls or turns. IMPORTANT for multi-lesson requests (e.g. \"add content to all the article lessons\"): only ONE tool call is ever acted on per message, so handle it ONE LESSON AT A TIME — pick a single lesson, write its complete content in this call, propose it, and tell the user you'll continue with the remaining lessons in follow-up turns once this one is reviewed. Never attempt a lightweight/metadata-only call planning to add real content later — there is no later call for the same proposal. For video and live_class, this can only enrich a lesson that ALREADY has a real url/scheduledAt — it never invents one, so it can't turn a brand-new, un-scheduled lesson into a complete one on its own. To create a brand-new lesson from scratch, use create_course_lesson (or generate_course_structure for a whole new course) instead — this tool never creates a lesson. To make a small, human-directed edit to a lesson's title/description/payload where the human is dictating the exact change (not asking you to write new educational content), use update_course_lesson instead — this tool is specifically for AI-authored substantive content generation. Never fabricate specific facts, statistics, or claims beyond what the course/module/lesson context and the user's request actually support. This always proposes a full replacement of the content — never silently merges with what was there before; the human reviewing it sees exactly what will be written. Mutating — requires human confirmation.",
  inputSchema: generateLessonContentInput,
  requiredPermissions: ["course.manage"],
  mutating: true,
  requiresConfirmation: true,
  scope: "tenant",
  summarizeProposal(input) {
    const contentField = input.articleBody ?? input.videoScript ?? input.liveClassAgenda ?? "";
    const preview = contentField.length > 400 ? `${contentField.slice(0, 400)}…` : contentField;
    const meta: string[] = [];
    if (input.audience) meta.push(`Audience: ${input.audience}`);
    if (input.difficulty) meta.push(`Difficulty: ${input.difficulty}`);
    if (input.tone) meta.push(`Tone: ${input.tone}`);
    return [`Generated content for lesson "${input.lessonTitle}":`, ...(meta.length > 0 ? [meta.join(" · ")] : []), "", preview].join("\n");
  },
  async execute(ctx: ToolContext, input) {
    const existing = await CourseService.getLessonContent(ctx, input.lessonId);
    if (!existing.ok) throw new Error(existing.error.message);

    const currentPayload = (existing.data.payload ?? {}) as Record<string, unknown>;
    let payload: Record<string, unknown>;
    if (existing.data.type === "article") {
      if (input.articleBody === undefined) throw new Error(`Lesson "${existing.data.title}" is an article — give articleBody, not videoScript/liveClassAgenda.`);
      payload = { ...currentPayload, body: input.articleBody };
    } else if (existing.data.type === "video") {
      if (input.videoScript === undefined) throw new Error(`Lesson "${existing.data.title}" is a video — give videoScript, not articleBody/liveClassAgenda.`);
      if (typeof currentPayload.url !== "string" || !currentPayload.url.trim()) {
        throw new Error(`Lesson "${existing.data.title}" has no video url yet — add one through the course editor before generating a script for it.`);
      }
      payload = { ...currentPayload, script: input.videoScript };
    } else if (existing.data.type === "live_class") {
      if (input.liveClassAgenda === undefined) throw new Error(`Lesson "${existing.data.title}" is a live_class — give liveClassAgenda, not articleBody/videoScript.`);
      if (typeof currentPayload.scheduledAt !== "string" || !currentPayload.scheduledAt.trim()) {
        throw new Error(`Lesson "${existing.data.title}" has no scheduled date yet — set one through the course editor before generating an agenda for it.`);
      }
      payload = { ...currentPayload, agenda: input.liveClassAgenda };
    } else {
      throw new Error(`Lesson "${existing.data.title}" is a ${existing.data.type} lesson — generate_lesson_content only supports article, video, and live_class. Use update_assessment to change its questions (or generate_assessment to create a brand-new assessment).`);
    }

    const result = await CourseService.updateLesson(ctx, input.lessonId, {
      title: input.title,
      description: input.description,
      payload,
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});

const assessmentQuestionInput = z.object({
  type: z.enum(["multiple_choice", "true_false", "scenario"]),
  text: z.string().max(1000).describe("The question itself. For a scenario question, include the situational context here."),
  choices: z.array(z.string().max(300)).max(6).optional().describe("Required (at least 2) for multiple_choice/scenario; omit for true_false."),
  correctAnswer: z.string().max(300).describe("Must exactly match one entry in choices (for multiple_choice/scenario), or be exactly \"true\"/\"false\" (for true_false)."),
  explanation: z.string().max(500).optional().describe("Why this is the correct answer — shown to a learner after answering, if the course player supports it."),
});

/**
 * AI Assessment Refinement & Editing phase — Phase 0 audit finding: `generate_assessment` used to
 * ALSO regenerate an existing assessment via an optional `lessonId` (kept alongside `moduleId` as
 * mutually-exclusive fields on one schema). That was the exact source of the ambiguity this phase
 * exists to fix — "make this quiz harder" and "create a new quiz" only differed by which OPTIONAL
 * field the model chose to populate on the SAME tool, a much weaker signal than the domain/resource/
 * operation TAG the model already uses to pick between tools entirely (`describeToolForProvider`).
 * This mirrors the exact fix already proven for `create_course_draft` vs `generate_course_structure`
 * (Course Generation AI Phase 1) — split into two tools whose tags themselves disambiguate intent
 * (`[courses → assessment.generate]` = always create-new, `[courses → assessment.update]` = always
 * modify-existing), rather than widening one tool's prose and hoping the model reads closely enough.
 * `generate_assessment` below is narrowed to moduleId-only (lessonId removed entirely — it is a
 * ZodError, not a silent branch, to pass one); seeded `update_assessment`'s doc comment below.
 */
const generateAssessmentInput = z
  .object({
    moduleId: z.string().uuid().describe("The module to create the NEW assessment lesson within."),
    title: z.string().max(150).describe("The new lesson's title."),
    assessmentType: z.enum(["test", "assignment"]).describe("Which content type to create."),
    difficulty: z.enum(["beginner", "intermediate", "advanced"]).optional(),
    instructions: z.string().max(1000).optional().describe("Free-text guidance, e.g. \"focus on phishing\", \"these should be scenario-based\"."),
    questions: z.array(assessmentQuestionInput).min(1).max(30).describe("The complete set of generated questions for this brand-new assessment."),
  })
  .superRefine((data, ctx) => {
    if (!data.title.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "title is required", path: ["title"] });
    }
    const error = validateAssessmentQuestions(data.questions);
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error, path: ["questions"] });
  });

registerTool({
  name: "generate_assessment",
  domain: "courses",
  resource: "assessment",
  operation: "generate",
  description:
    "Create a BRAND-NEW test/assignment lesson (give moduleId + title + assessmentType) with a generated set of quiz/assessment questions (multiple_choice, true_false, or scenario). This ALWAYS creates a new lesson — it can NEVER modify, regenerate, or add to an assessment that already exists, even if the user's request would result in an equivalent full replacement (e.g. \"regenerate this quiz\" or \"make this quiz harder\" — both target an EXISTING assessment, so use update_assessment instead, never this tool, even though the underlying data change might look similar). To ground questions in real course material, read the relevant course/module/lesson content first (list_course_lessons / get_course_lesson_content) — this tool itself does not read anything, it only writes the questions given to it. Never invent a correctAnswer that doesn't exactly match one of a question's own choices. Ground every question in what the user's request and the course material actually cover — never fabricate specific facts or statistics. This never publishes, activates, or grades anything — the created lesson stays in whatever draft status the course already uses. Mutating — requires human confirmation.",
  inputSchema: generateAssessmentInput,
  requiredPermissions: ["course.manage"],
  mutating: true,
  requiresConfirmation: true,
  scope: "tenant",
  summarizeProposal(input) {
    const lines: string[] = [`New ${input.assessmentType} "${input.title}" — ${input.questions.length} question(s):`];
    input.questions.forEach((q: { text: string; type: string; correctAnswer: string }, i: number) => {
      lines.push(`${i + 1}. [${q.type}] ${q.text} (answer: ${q.correctAnswer})`);
    });
    return lines.join("\n");
  },
  async execute(ctx: ToolContext, input) {
    const result = await CourseService.createLesson(ctx, { courseId: "", moduleId: input.moduleId }, { type: input.assessmentType, title: input.title, payload: { questions: input.questions } });
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});

/**
 * `update_assessment` — the counterpart this phase adds: the ONLY tool that modifies an EXISTING
 * test/assignment lesson's questions (regenerate all, make harder/easier, add, remove, replace, or
 * edit specific questions — all of these reduce to "submit the complete new question set," exactly
 * like `reorder_course_modules`/`reorder_course_lessons` already require the COMPLETE new order
 * rather than a "move X" delta instruction; same reason: it pushes the easy part — computing the
 * full resulting list — onto the model, which just read the current one, and lets the server do a
 * single, simple, unambiguous verification instead of interpreting a delta instruction itself).
 *
 * `currentQuestions` (required, may be an empty array) is the model's own echo of the assessment's
 * CURRENT state, exactly as it just read it via `get_course_lesson_content` (or pulled from a prior
 * confirmed `generate_assessment`/`update_assessment` result already in this conversation's
 * structured history — `reconstructHistory` makes that a trustworthy source too, same precedent
 * every other display-only echo field in this file already relies on, e.g. `lessonTitle`). It serves
 * two purposes, both load-bearing:
 *   1. A REAL, non-fabricated "before" state for the proposal card to diff against — the one case in
 *      this codebase where an update proposal CAN show a trustworthy before/after (every other update
 *      tool's doc comment explains why it normally can't: `execute()` never runs before confirmation,
 *      so there is nothing to read yet — here, the model already read it and is echoing it back,
 *      exactly like `orderedResourceRef.title` on the reorder tools).
 *   2. A staleness guard at confirm time (Phase 0 audit finding: this codebase has NO optimistic
 *      locking/version column anywhere, for any resource — see `course-service.ts`'s own doc comment
 *      on this; inventing one just for AI-driven assessment edits would be exactly the kind of
 *      "invent a parallel system with no precedent" this phase was told not to do). Instead,
 *      `execute()` re-reads the lesson fresh and compares its ACTUAL current `questions` against this
 *      echoed baseline — the same "submit the full expected state, server verifies an exact match
 *      before writing anything" precedent the reorder tools already established. A mismatch fails
 *      the whole write with a clear message; nothing is partially applied.
 *
 * Never accepts `moduleId`/`courseId` — like `update_course_lesson`, the target is resolved entirely
 * from `lessonId` via `CourseService.getLessonContent`/`updateLesson`, so there is no field through
 * which this tool could ever touch a lesson in a different module/course than the one it read.
 */
const updateAssessmentInput = z
  .object({
    lessonId: z.string().uuid().describe("The EXISTING test/assignment lesson to update — resolve this via list_course_lessons/get_course_lesson_content first if the user referred to it by name or description rather than giving you its id directly."),
    title: z.string().max(150).describe("The lesson's CURRENT title, exactly as returned by list_course_lessons/get_course_lesson_content — shown to the human reviewing this proposal so they can confirm it's the right assessment. Purely for display; never used to resolve the lesson."),
    currentQuestions: z
      .array(z.record(z.unknown()))
      .describe("The assessment's CURRENT questions, EXACTLY as returned by get_course_lesson_content (or a prior confirmed generate_assessment/update_assessment result in this conversation) — echo them back unmodified. Use an empty array if the lesson has no questions yet. Never guess or reconstruct this from memory; if you haven't actually read the current questions in this conversation, call get_course_lesson_content first."),
    questions: z.array(assessmentQuestionInput).min(1).max(30).describe("The COMPLETE new question set to save — every question that should exist afterward, including any unchanged ones carried over from currentQuestions, not just the ones you're adding or changing. This REPLACES the lesson's entire question set; it does not merge."),
    changeSummary: z.string().max(300).optional().describe("A brief plain-language note on what changed, e.g. \"Made all questions harder\" or \"Added 2 scenario questions\" — shown on the proposal for the human reviewer. Purely descriptive, never affects what's saved."),
  })
  .superRefine((data, ctx) => {
    if (!data.title.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "title is required", path: ["title"] });
    }
    const error = validateAssessmentQuestions(data.questions);
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error, path: ["questions"] });
  });

registerTool({
  name: "update_assessment",
  domain: "courses",
  resource: "assessment",
  operation: "update",
  description:
    "Modify the questions of an EXISTING test/assignment lesson — regenerate some or all questions, make them harder/easier/more beginner-friendly, add questions, remove a specific question, replace a specific question, edit one question's text/choices/correct answer/explanation/type, or change the total question count. This is the ONLY tool for any request that targets an assessment that already exists — never call generate_assessment for these, even a full \"regenerate this quiz\" request (that tool only ever creates a brand-new lesson). ALWAYS call get_course_lesson_content first (unless you already have its current questions fresh from earlier in this conversation) to read the CURRENT question set, then submit BOTH currentQuestions (exactly what you read, unmodified) and questions (the complete new set to save, including every question that stays the same — not just the ones changing). If the assessment changed since you last read it, this fails safely with no write — re-read and try again rather than guessing. Never invent a correctAnswer that doesn't exactly match one of a question's own choices. Never fabricate specific facts or statistics. This never publishes, activates, or grades anything, and never changes the lesson's type, module, or course. Mutating — requires human confirmation.",
  inputSchema: updateAssessmentInput,
  requiredPermissions: ["course.manage"],
  mutating: true,
  requiresConfirmation: true,
  scope: "tenant",
  summarizeProposal(input) {
    const lines: string[] = [
      `Update assessment "${input.title}" — ${input.currentQuestions.length} → ${input.questions.length} question(s)${input.changeSummary ? ` (${input.changeSummary})` : ""}:`,
    ];
    input.questions.forEach((q: { text: string; type: string; correctAnswer: string }, i: number) => {
      lines.push(`${i + 1}. [${q.type}] ${q.text} (answer: ${q.correctAnswer})`);
    });
    return lines.join("\n");
  },
  async execute(ctx: ToolContext, input) {
    const existing = await CourseService.getLessonContent(ctx, input.lessonId);
    if (!existing.ok) throw new Error(existing.error.message);
    if (existing.data.type !== "test" && existing.data.type !== "assignment") {
      throw new Error(`Lesson "${existing.data.title}" is a ${existing.data.type} lesson, not a test/assignment — cannot update its questions.`);
    }

    const currentPayload = (existing.data.payload ?? {}) as Record<string, unknown>;
    const actualCurrentQuestions = Array.isArray(currentPayload.questions) ? currentPayload.questions : [];
    if (!isDeepStrictEqual(actualCurrentQuestions, input.currentQuestions)) {
      throw new Error(
        `The "${existing.data.title}" assessment's questions have changed since this proposal was created — please read its current questions again and try your request once more.`,
      );
    }

    const result = await CourseService.updateLesson(ctx, input.lessonId, { payload: { ...currentPayload, questions: input.questions } });
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});
