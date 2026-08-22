export type ContentItemType = "video" | "article" | "live_class" | "test" | "assignment" | "external_import";

/**
 * AI Lesson Content & Assessment Generation phase — a real, structured shape for `test`/`assignment`
 * questions, living in the SAME `content_items.payload` jsonb column that already existed (no
 * database migration; validated here in the application layer, the exact same "payload shape
 * depends on a type value looked up elsewhere" precedent this file's own module doc comment already
 * documents for `video`/`article`/`live_class`/`external_import`).
 *
 * Audited before adding this: `test`/`assignment` previously had NO question/answer model
 * whatsoever — the existing manual course editor (`test-assignment-form.tsx`) is an explicit
 * "placeholder-shell," always saving `payload: {}`, with real content meant to be attached as a
 * File Attachment (an unstructured document) instead. That remains fully supported — `{}` is still
 * completely valid below, unchanged. `questions` is purely additive: only validated when present,
 * so no existing test/assignment content item is invalidated by this change. The existing manual
 * editor does not yet render or let a human edit `payload.questions` — an AI-ahead-of-manual-UI gap,
 * documented rather than silently left unmentioned, matching this project's own precedent for the
 * same situation with `archived` status in an earlier phase.
 */
export type AssessmentQuestionType = "multiple_choice" | "true_false" | "scenario";

export interface AssessmentQuestion {
  type: AssessmentQuestionType;
  text: string;
  /** Required (min 2) for `multiple_choice`/`scenario`; not used for `true_false`. */
  choices?: string[];
  /** For `multiple_choice`/`scenario`: must exactly match one entry in `choices` (the actual answer
   * text, not an index — simpler for a human reviewing the proposal to verify at a glance, and
   * avoids an off-by-one/0-vs-1-indexed ambiguity a generated index could introduce). For
   * `true_false`: must be exactly `"true"` or `"false"`. */
  correctAnswer: string;
  explanation?: string;
}

/** Structural validation only (shape, required fields, `correctAnswer` actually references a real
 * choice) — never a judgment on question QUALITY. Returns `null` for a valid array; a
 * human-readable reason otherwise. Exported so both the AI tool's own Zod `.superRefine()` (rejects
 * a malformed set before a proposal is even created) and `validateContentItemPayload` below
 * (defense-in-depth at confirm time) share one implementation — the same two-entry-point
 * relationship every other generated-content validator in this codebase already has. */
export function validateAssessmentQuestions(questions: unknown): string | null {
  if (!Array.isArray(questions) || questions.length === 0) {
    return "payload.questions must be a non-empty array";
  }
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i] as Partial<AssessmentQuestion> | null;
    const label = `Question ${i + 1}`;
    if (!q || typeof q !== "object") {
      return `${label}: must be an object`;
    }
    if (q.type !== "multiple_choice" && q.type !== "true_false" && q.type !== "scenario") {
      return `${label}: type must be "multiple_choice", "true_false", or "scenario"`;
    }
    if (typeof q.text !== "string" || !q.text.trim()) {
      return `${label}: text is required`;
    }
    if (typeof q.correctAnswer !== "string" || !q.correctAnswer.trim()) {
      return `${label}: correctAnswer is required`;
    }
    if (q.type === "true_false") {
      if (q.correctAnswer !== "true" && q.correctAnswer !== "false") {
        return `${label}: a true_false question's correctAnswer must be exactly "true" or "false"`;
      }
    } else {
      if (!Array.isArray(q.choices) || q.choices.length < 2 || q.choices.some((c) => typeof c !== "string" || !c.trim())) {
        return `${label}: choices must be an array of at least 2 non-blank strings`;
      }
      if (!q.choices.includes(q.correctAnswer)) {
        return `${label}: correctAnswer must exactly match one of the given choices`;
      }
    }
  }
  return null;
}

export const CONTENT_ITEM_TYPES: ContentItemType[] = [
  "video",
  "article",
  "live_class",
  "test",
  "assignment",
  "external_import",
];

/**
 * data-model.md's per-type required-field table (research.md §3). Each type's payload shape is
 * validated here, in the application layer, never as a database CHECK — mirrors
 * `validateCustomFieldValues` (custom-fields/save-values.ts)'s precedent for "payload shape depends on
 * a type/config value looked up elsewhere."
 */
export function validateContentItemPayload(
  type: ContentItemType,
  payload: Record<string, unknown> | undefined,
): { error: string | null } {
  const p = payload ?? {};

  switch (type) {
    case "video":
      // Video Lesson Upload — an uploaded video (`payload.videoAttachmentId`, a durable
      // `file_attachments.id`) is now an alternative to the original "video URL" method
      // (`payload.url`), the same either/or shape `article` already has for `body`/`externalUrl`.
      // `uploadPending` is a third, deliberately narrow case: a real upload is in progress and this
      // content item is only a valid anchor row until it finishes — never a legitimate end state.
      // `CourseService.updateLesson` additionally refuses to let a lesson with `uploadPending` ever
      // reach `status: "published"`, so this can never become a loophole for "complete" content that
      // was never actually uploaded.
      if (p.uploadPending === true) {
        return { error: null };
      }
      if (typeof p.videoAttachmentId === "string" && p.videoAttachmentId.trim()) {
        return { error: null };
      }
      if (typeof p.url === "string" && p.url.trim()) {
        return { error: null };
      }
      return { error: "payload.url or payload.videoAttachmentId is required for video content" };
    case "article":
      if ((typeof p.body !== "string" || !p.body.trim()) && (typeof p.externalUrl !== "string" || !p.externalUrl.trim())) {
        return { error: "payload.body or payload.externalUrl is required for article content" };
      }
      return { error: null };
    case "live_class":
      if (typeof p.scheduledAt !== "string" || !p.scheduledAt.trim()) {
        return { error: "payload.scheduledAt is required for live_class content" };
      }
      return { error: null };
    case "test":
    case "assignment":
      // `{}` (no `questions` key at all) stays fully valid, unchanged — the existing manual
      // placeholder-shell editor's own behavior. `questions` is only validated when present.
      if (p.questions !== undefined) {
        const error = validateAssessmentQuestions(p.questions);
        if (error) return { error };
      }
      return { error: null };
    case "external_import":
      if (typeof p.url !== "string" || !p.url.trim()) {
        return { error: "payload.url is required for external_import content" };
      }
      if (typeof p.sourceType !== "string" || !p.sourceType.trim()) {
        return { error: "payload.sourceType is required for external_import content" };
      }
      return { error: null };
    default:
      return { error: "Invalid type" };
  }
}
