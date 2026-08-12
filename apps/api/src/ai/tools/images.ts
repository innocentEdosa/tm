import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { registerTool } from "../tool-registry";
import type { ToolContext } from "../types";
import { CourseService } from "../../courses/course-service";
import { ImageSearchService } from "../../images/image-search-service";
import type { ImageCandidate } from "../../images/image-provider";
import { aiToolExecutions } from "../../db/schema/ai";

/**
 * AI Image Discovery & Course Asset Management Phase 1 — three tools:
 *   - `search_course_images` (read-only): discovers candidates for a course's or a lesson's image.
 *   - `set_course_image` / `set_lesson_image` (mutating): persists ONE candidate a prior search in
 *     THIS conversation actually returned.
 *
 * Search and selection are deliberately separate tools, never one — searching must never write
 * anything (Phase 1's own "search ≠ save" requirement), and a selection must never trust a
 * model-supplied URL. Every AI tool here wraps `CourseService`/`ImageSearchService` — never touches
 * Drizzle directly except for the one narrowly-scoped read below that verifies a selection against
 * real search history, which is AI-conversation bookkeeping (`ai_tool_executions`), not a course
 * concern `CourseService` should know about.
 *
 * `RECENT_SEARCH_LOOKBACK` bounds how far back a selection tool will look for a matching search
 * result — mirrors `reconstruct-history.ts`'s own `RECENT_STRUCTURED_RESULTS` bounding philosophy
 * (recent conversation context is what matters; unbounded history scans aren't needed for this to
 * work in practice and would only grow query cost on a long-running conversation).
 */
const RECENT_SEARCH_LOOKBACK = 10;

/**
 * The ONLY place a `providerImageId` is ever trusted to mean a real image — looks up recent
 * `search_course_images` executions in this exact conversation (tenant/RLS-scoped via `ctx.db`,
 * same as every other query in this codebase), requires the search to have targeted the SAME
 * `courseId` (the actual scope/safety boundary — `lessonId` is match-if-present context, not itself
 * a restriction, so "search for this course" then "use it for lesson X in that course" still
 * resolves), and returns the real, provider-verified `ImageCandidate` — never anything derived from
 * the caller's own tool-call arguments. Returns `null` (never throws) when nothing matches, so the
 * caller can fail with one clear, consistent message.
 */
async function resolveCandidateFromRecentSearches(
  ctx: ToolContext,
  target: { courseId: string },
  providerImageId: string,
): Promise<ImageCandidate | null> {
  if (!ctx.conversationId) return null;

  const rows = await ctx.db
    .select({ input: aiToolExecutions.input, output: aiToolExecutions.output })
    .from(aiToolExecutions)
    .where(and(eq(aiToolExecutions.conversationId, ctx.conversationId), eq(aiToolExecutions.toolName, "search_course_images"), eq(aiToolExecutions.status, "executed")))
    .orderBy(desc(aiToolExecutions.createdAt))
    .limit(RECENT_SEARCH_LOOKBACK);

  for (const row of rows) {
    const input = row.input as { courseId?: string } | null;
    if (!input || input.courseId !== target.courseId) continue;
    const output = row.output as { candidates?: ImageCandidate[] } | null;
    const match = output?.candidates?.find((c) => c.providerImageId === providerImageId);
    if (match) return match;
  }
  return null;
}

const searchCourseImagesInput = z.object({
  courseId: z.string().uuid().describe("The course this image search is for — resolve via list_courses/get_course first if the user referred to it by name."),
  lessonId: z.string().uuid().optional().describe("If searching specifically for a lesson's image, that lesson's id (must belong to courseId) — resolve via list_course_lessons first. Omit when searching for the course's own image."),
  moduleId: z.string().uuid().optional().describe("Optional — a module id (must belong to courseId), purely to help construct a more relevant query when the user references a module by name. Not required and never itself a search target (modules have no image of their own in this phase)."),
  query: z
    .string()
    .min(2)
    .max(200)
    .describe(
      "A concise, relevant search query YOU construct — a few keywords capturing the subject (e.g. \"servant leadership empathy active listening professional workplace\"), grounded in the course/lesson title, description, category, and objectives already visible to you in this conversation. Never paste raw lesson article content or long descriptions verbatim — summarize into keywords. Never just \"image\" or similarly generic.",
    ),
});

registerTool({
  name: "search_course_images",
  domain: "courses",
  resource: "image",
  operation: "search",
  description:
    "Search for stock-photo candidates for a course's or a specific lesson's image. Read-only — this NEVER assigns an image to anything, it only returns candidates for the human to review; searching is completely separate from selecting/saving one. Always construct a concise query yourself from context already available in this conversation (course title/description/category/objectives, or a lesson's title/description) rather than asking the user to type one, unless they want something specific you don't already know. To actually set one of the results as the course's or lesson's image, use set_course_image or set_lesson_image with that EXACT candidate's providerImageId — never invent an image URL, and never call this tool expecting it to also save anything.",
  inputSchema: searchCourseImagesInput,
  requiredPermissions: ["course.manage"],
  mutating: false,
  requiresConfirmation: false,
  scope: "tenant",
  async execute(ctx: ToolContext, input) {
    const course = await CourseService.getCourse(ctx, input.courseId);
    if (!course.ok) throw new Error(course.error.message);

    if (input.lessonId) {
      const lesson = await CourseService.getLessonContent(ctx, input.lessonId);
      if (!lesson.ok) throw new Error(lesson.error.message);
      if (lesson.data.courseId !== input.courseId) throw new Error("That lesson does not belong to the given course.");
    }
    if (input.moduleId) {
      const modules = await CourseService.listModules(ctx, input.courseId);
      if (!modules.ok) throw new Error(modules.error.message);
      if (!modules.data.some((m) => m.id === input.moduleId)) throw new Error("That module does not belong to the given course.");
    }

    const result = await ImageSearchService.search(input.query);
    if (!result.ok) throw new Error(result.error.message);
    return { query: input.query, candidates: result.data };
  },
});

/** Shared by both selection tools — every field beyond `providerImageId` itself is a DISPLAY-ONLY
 * echo (same precedent as `lessonTitle` elsewhere in this codebase): the model copies these directly
 * from the candidate it saw in a `search_course_images` result so the proposal card can render a
 * real preview and real attribution before confirmation. None of them is ever used to resolve or
 * persist the image — `execute()` re-derives every one of these fields from the server-verified
 * candidate (see `resolveCandidateFromRecentSearches`); a mismatched `imageUrl` specifically is
 * caught and rejected (see both tools' `execute()`), so a wrong echo fails safely rather than
 * silently showing the wrong preview. */
const imageSelectionEchoFields = {
  imageUrl: z.string().url().max(2000).describe("The chosen candidate's own imageUrl, copied EXACTLY from the search_course_images result — shown to the human reviewing this proposal as a preview. Never invent or alter this. The value actually persisted is independently re-verified server-side against that same search result, so this only controls what's shown before confirmation, never what's saved."),
  previewUrl: z.string().url().max(2000).describe("The chosen candidate's own previewUrl, copied exactly from the search result."),
  title: z.string().max(300).optional().describe("The chosen candidate's own title, if it had one, copied exactly from the search result."),
  author: z.string().max(200).optional().describe("The chosen candidate's own author name, if the provider supplied one, copied exactly from the search result."),
  authorUrl: z.string().url().max(2000).optional().describe("The chosen candidate's own authorUrl, if the provider supplied one, copied exactly from the search result."),
  sourceUrl: z.string().url().max(2000).optional().describe("The chosen candidate's own sourceUrl (the provider's page for this image), if supplied, copied exactly from the search result."),
  license: z.string().max(200).optional().describe("The chosen candidate's own license name, if the provider supplied one, copied exactly from the search result."),
  licenseUrl: z.string().url().max(2000).optional().describe("The chosen candidate's own licenseUrl, if the provider supplied one, copied exactly from the search result."),
};

const setCourseImageInput = z.object({
  courseId: z.string().uuid().describe("The course whose image is being set — resolve via list_courses/get_course first."),
  providerImageId: z.string().min(1).max(200).describe("The EXACT providerImageId of the chosen candidate from a PRIOR search_course_images result in THIS conversation — never invent one; if you haven't searched yet, call search_course_images first."),
  ...imageSelectionEchoFields,
});

registerTool({
  name: "set_course_image",
  domain: "courses",
  resource: "image",
  operation: "set_course",
  description:
    "Set a course's image to a specific candidate from a PRIOR search_course_images result in this same conversation (give the exact providerImageId — e.g. \"use image 2\" means that candidate's own providerImageId, never an index or invented value). This can only select from real search results for this exact course — if no matching candidate is found, it fails safely rather than accepting an arbitrary URL. Replaces the course's current image entirely (a course only ever has one). Never call this for a request about a LESSON's image — use set_lesson_image instead. Mutating — requires human confirmation.",
  inputSchema: setCourseImageInput,
  requiredPermissions: ["course.manage"],
  mutating: true,
  requiresConfirmation: true,
  scope: "tenant",
  summarizeProposal(input) {
    return `Set the course's image to the selected photo${input.title ? ` ("${input.title}")` : ""}${input.author ? ` by ${input.author}` : ""}.`;
  },
  async execute(ctx: ToolContext, input) {
    const candidate = await resolveCandidateFromRecentSearches(ctx, { courseId: input.courseId }, input.providerImageId);
    if (!candidate) {
      throw new Error("Couldn't find that image among this conversation's recent search results for this course — please search again and select from the real results.");
    }
    if (candidate.imageUrl !== input.imageUrl) {
      throw new Error("The selected image doesn't match a real search result for this course — please search again and select from the results shown.");
    }

    await ImageSearchService.trackSelection(candidate);
    const result = await CourseService.setCourseImage(ctx, input.courseId, candidate);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});

const setLessonImageInput = z.object({
  lessonId: z.string().uuid().describe("The lesson whose image is being set — resolve via list_course_lessons/get_course_lesson_content first."),
  courseId: z.string().uuid().describe("The course the lesson belongs to — must match the course a prior search_course_images call for this lesson used."),
  providerImageId: z.string().min(1).max(200).describe("The EXACT providerImageId of the chosen candidate from a PRIOR search_course_images result in THIS conversation — never invent one."),
  ...imageSelectionEchoFields,
});

registerTool({
  name: "set_lesson_image",
  domain: "courses",
  resource: "image",
  operation: "set_lesson",
  description:
    "Set a lesson's image to a specific candidate from a PRIOR search_course_images result in this same conversation (give the exact providerImageId). Attaches it as a lesson resource (the existing 'Lesson Resources' mechanism), replacing only a PRIOR AI-selected image on that lesson if there is one — never removes a manually-added resource the user attached themselves. This can only select from real search results for this exact course — if no matching candidate is found, it fails safely rather than accepting an arbitrary URL. Never call this for a request about a COURSE's own image — use set_course_image instead. Mutating — requires human confirmation.",
  inputSchema: setLessonImageInput,
  requiredPermissions: ["course.manage"],
  mutating: true,
  requiresConfirmation: true,
  scope: "tenant",
  summarizeProposal(input) {
    return `Set the lesson's image to the selected photo${input.title ? ` ("${input.title}")` : ""}${input.author ? ` by ${input.author}` : ""}.`;
  },
  async execute(ctx: ToolContext, input) {
    const lesson = await CourseService.getLessonContent(ctx, input.lessonId);
    if (!lesson.ok) throw new Error(lesson.error.message);
    if (lesson.data.courseId !== input.courseId) {
      throw new Error("That lesson does not belong to the given course.");
    }

    const candidate = await resolveCandidateFromRecentSearches(ctx, { courseId: input.courseId }, input.providerImageId);
    if (!candidate) {
      throw new Error("Couldn't find that image among this conversation's recent search results for this course — please search again and select from the real results.");
    }
    if (candidate.imageUrl !== input.imageUrl) {
      throw new Error("The selected image doesn't match a real search result for this course — please search again and select from the results shown.");
    }

    await ImageSearchService.trackSelection(candidate);
    const result = await CourseService.setLessonImage(ctx, input.lessonId, candidate);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});
