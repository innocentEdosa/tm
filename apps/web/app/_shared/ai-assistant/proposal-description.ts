import type { AiToolExecution } from "@/lib/ai-api-client";

/**
 * Pure, framework-free proposal-description logic — extracted out of `proposal-card.tsx` (AI Course
 * Experience — UI Consistency phase) specifically so it can be unit-tested without jsdom or a
 * component-rendering setup (this app has no such infra; `packages/form-builder`'s own
 * `vitest.config.ts` — `environment: "node"`, pure `.test.ts` files only — is the precedent this
 * mirrors). No behavior change from when this lived inline in `proposal-card.tsx`.
 */

/**
 * AI Image Discovery & Course Asset Management Phase 1 — the one case a proposal needs to render
 * more than a `{label, value}` row: an actual image. Every field here is an ECHO of what the AI tool
 * call's own `input` already carried (never fabricated by this component) — `ai/tools/images.ts`'s
 * own doc comment on why echoing these specific fields is safe even though they're display-only.
 */
export interface ProposalImagePreview {
  imageUrl: string;
  title: string | null;
  author: string | null;
  authorUrl: string | null;
  sourceUrl: string | null;
  license: string | null;
  licenseUrl: string | null;
}

export interface ProposalDetail {
  title: string;
  subtitle: string;
  rows: { label: string; value: string }[];
  actionLabel: string;
  reversibilityNote: string;
  /** Present only for `set_course_image`/`set_lesson_image` proposals — `ProposalCard` renders an
   * actual `<img>` plus attribution when this is set. */
  imagePreview?: ProposalImagePreview;
}

const UPDATE_FIELD_LABELS: Record<string, Record<string, string>> = {
  update_course: {
    title: "Title",
    description: "Description",
    category: "Category",
    deliveryMode: "Delivery mode",
    duration: "Duration",
    provider: "Provider",
    cost: "Cost",
    subcategory: "Subcategory",
    learningObjectives: "Learning objectives",
    requirements: "Requirements",
  },
  update_course_module: { title: "Title", description: "Description" },
  update_course_lesson: { title: "Title", description: "Description", payload: "Content" },
};

/** Identifier fields every update tool's input carries alongside the fields actually changing —
 * never shown as a "change" row (they name WHICH resource, not what's different about it). */
const UPDATE_ID_FIELDS = new Set(["courseId", "moduleId", "lessonId"]);

function formatUpdateValue(key: string, value: unknown): string {
  if (value === null) return "(cleared)";
  if (key === "duration" && value && typeof value === "object") {
    const duration = value as { value?: number; unit?: string };
    return `${duration.value ?? ""} ${duration.unit ?? ""}`.trim();
  }
  if (Array.isArray(value)) return value.length > 0 ? value.join("; ") : "(none)";
  if (key === "payload" && value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * `update_course`/`update_course_module`/`update_course_lesson` share this one renderer — same
 * partial-update shape (only fields actually present in `input` are shown, matching "only display
 * fields that are actually changing"), same reason NO "old value" column exists: `execution.input`
 * is the real, trusted tool-call arguments (never fabricated), but there is no trustworthy "before"
 * value available at proposal time in this architecture — `execute()` (where a resource's current
 * state would actually get read) only ever runs at confirm time, never before a human approves the
 * proposal. Showing an old value captured any other way would risk showing stale or model-guessed
 * data, which is worse than not showing one at all — so this explicitly says so instead of inventing
 * a before/after diff (AI Course Editing Phase 1, "before/after safety": indicate unavailability
 * rather than fabricate).
 */
export function describeUpdateProposal(toolName: string, input: Record<string, unknown>): ProposalDetail {
  const labels = UPDATE_FIELD_LABELS[toolName] ?? {};
  const resourceLabel = toolName === "update_course" ? "course" : toolName === "update_course_module" ? "module" : "lesson";
  const rows = Object.entries(input)
    .filter(([key, value]) => !UPDATE_ID_FIELDS.has(key) && value !== undefined)
    .map(([key, value]) => ({ label: labels[key] ?? key, value: formatUpdateValue(key, value) }));

  return {
    title: `Update ${resourceLabel}`,
    subtitle: "New values below — checked against the live record when you confirm.",
    rows: rows.length > 0 ? rows : [{ label: "Change", value: "No fields specified" }],
    actionLabel: `Update ${resourceLabel}`,
    reversibilityNote: "You can change this again later.",
  };
}

/**
 * `reorder_course_modules`/`reorder_course_lessons` (Course Organization AI Phase 1) — same
 * "only render `execution.input`, never fabricate a before state" rule the update tools follow.
 * There is no separate "current order" row here for the same reason no update tool shows an old
 * value: it isn't part of the trusted `input` the model actually sent, and this architecture only
 * ever reads a resource's live state inside `execute()`, which never runs before a human confirms.
 * The subtitle says so explicitly rather than silently omitting it — the current order was already
 * visible in the conversation just above (from the `list_course_modules`/`list_course_lessons` call
 * this tool's own description requires before proposing a reorder). Each entry's `title` comes
 * straight from the tool call's own arguments (the model echoing back what it just discovered),
 * never invented by this component.
 */
export function describeReorderProposal(toolName: string, input: Record<string, unknown>): ProposalDetail {
  const isModules = toolName === "reorder_course_modules";
  const entries = Array.isArray(input[isModules ? "modules" : "lessons"]) ? (input[isModules ? "modules" : "lessons"] as { id?: string; title?: string }[]) : [];
  return {
    title: isModules ? "Reorder modules" : "Reorder lessons",
    subtitle: "New order below — current order was shown just above.",
    rows: entries.length > 0 ? entries.map((entry, i) => ({ label: `${i + 1}.`, value: entry.title ?? entry.id ?? "" })) : [{ label: "Change", value: "No order specified" }],
    actionLabel: isModules ? "Reorder modules" : "Reorder lessons",
    reversibilityNote: "You can reorder again at any time.",
  };
}

/**
 * `archive_course_module`/`archive_course_lesson` (Course Organization AI Phase 1) — a reversible
 * status change, not a deletion (see `ai/tools/courses.ts`'s doc comment on the two tools). `title`
 * comes straight from the tool call's own arguments — the model echoing back the name it just
 * resolved via `list_course_modules`/`list_course_lessons`, never invented here.
 */
export function describeArchiveProposal(toolName: string, input: Record<string, unknown>): ProposalDetail {
  const isModule = toolName === "archive_course_module";
  const name = typeof input.title === "string" ? input.title : "this " + (isModule ? "module" : "lesson");
  return {
    title: isModule ? "Archive module" : "Archive lesson",
    subtitle: name,
    rows: [{ label: "Action", value: `Archive ${isModule ? "this module" : "this lesson"}` }],
    actionLabel: isModule ? "Archive module" : "Archive lesson",
    reversibilityNote: `This ${isModule ? "module and its lessons stay" : "lesson stays"} in the database and can be restored later — nothing is permanently deleted, and this doesn't affect ordering.`,
  };
}

/**
 * `generate_course_structure` (Course Generation AI Phase 1) — the richest proposal this app
 * renders: a whole course plus every module's lessons. `ProposalCard`'s row shape (`{label, value}[]`,
 * no nested/collapsible UI) is unchanged from every other tool — Phase 10's "don't dump raw JSON,
 * keep it readable even for a large course" is satisfied by ONE ROW PER MODULE, with that module's
 * own lesson titles joined into the row's value (mirrors `create_course_draft`'s existing "one row
 * per module" pattern, extended one level to include lessons) rather than building new expandable
 * component machinery for what is, even at the generation limits (10 modules × 8 lessons), a
 * fundamentally short, scannable list. Every title shown comes straight from `execution.input` — the
 * model's own generated plan, never fabricated by this component.
 */
export function describeGenerateProposal(input: Record<string, unknown>): ProposalDetail {
  const modules = Array.isArray(input.modules) ? (input.modules as { title?: string; lessons?: { title?: string }[] }[]) : [];
  const duration = input.duration as { value?: number; unit?: string } | undefined;
  const objectives = Array.isArray(input.learningObjectives) ? (input.learningObjectives as string[]) : [];
  const requirements = Array.isArray(input.requirements) ? (input.requirements as string[]) : [];
  const lessonCount = modules.reduce((sum, m) => sum + (m.lessons?.length ?? 0), 0);

  return {
    title: String(input.title ?? "New course"),
    subtitle: `Status: Draft (unpublished) · ${modules.length} module${modules.length === 1 ? "" : "s"} · ${lessonCount} lesson${lessonCount === 1 ? "" : "s"}`,
    rows: [
      ...(input.description ? [{ label: "Description", value: String(input.description) }] : []),
      { label: "Category", value: String(input.category ?? "") },
      { label: "Delivery", value: String(input.deliveryMode ?? "") },
      ...(duration?.value ? [{ label: "Duration", value: `${duration.value} ${duration.unit ?? ""}` }] : []),
      ...(input.provider ? [{ label: "Provider", value: String(input.provider) }] : []),
      ...(input.cost !== undefined && input.cost !== null ? [{ label: "Cost", value: String(input.cost) }] : []),
      ...(objectives.length > 0 ? [{ label: "Objectives", value: objectives.join("; ") }] : []),
      ...(requirements.length > 0 ? [{ label: "Requirements", value: requirements.join("; ")}] : []),
      ...modules.map((module, i) => ({
        label: `Module ${i + 1}`,
        value: `${module.title ?? ""}${module.lessons && module.lessons.length > 0 ? ` — ${module.lessons.map((l) => l.title ?? "").join("; ")}` : ""}`,
      })),
    ],
    actionLabel: "Create course",
    reversibilityNote: "Created as a draft, unpublished course — nothing is visible to learners until you publish it, and you can edit, reorder, archive, or delete anything in it freely before then.",
  };
}

const CONTENT_PREVIEW_MAX_CHARS = 600;

function truncateContent(text: string): string {
  if (text.length <= CONTENT_PREVIEW_MAX_CHARS) return text;
  return `${text.slice(0, CONTENT_PREVIEW_MAX_CHARS)}… [${text.length} characters total — the full text is what gets saved on confirm]`;
}

/**
 * `generate_lesson_content` (AI Lesson Content & Assessment Generation phase) — the generated
 * content field (articleBody/videoScript/liveClassAgenda — exactly one is ever present, matching the
 * tool's own schema) is TRUNCATED for the preview row only; `execution.input` itself always still
 * carries the complete text, which is exactly what gets written on confirm — truncation is a display
 * concern, never a data concern (Phase 10: "the complete proposed payload remains available for
 * confirmation"). `lessonTitle` is the model's own echo of the real lesson name it looked up, not
 * fabricated here.
 *
 * Lesson Content Reliability Fix: `ProposalCard` calls this for a `failed` execution too (to get a
 * status-line title), and a failed execution's `input` can be exactly the malformed shape that
 * caused the failure — most commonly, all three content fields missing. Falls back to the neutral
 * "content" label rather than defaulting to "live class agenda" (the last branch of the old ternary,
 * which would otherwise mislabel a call that specified none of the three).
 */
export function describeGenerateLessonContentProposal(input: Record<string, unknown>): ProposalDetail {
  const lessonTitle = typeof input.lessonTitle === "string" ? input.lessonTitle : "this lesson";
  const contentType =
    input.articleBody !== undefined ? "article" : input.videoScript !== undefined ? "video script" : input.liveClassAgenda !== undefined ? "live class agenda" : "content";
  const content = typeof input.articleBody === "string" ? input.articleBody : typeof input.videoScript === "string" ? input.videoScript : typeof input.liveClassAgenda === "string" ? input.liveClassAgenda : "";

  const rows: { label: string; value: string }[] = [];
  if (typeof input.title === "string") rows.push({ label: "New title", value: input.title });
  if (typeof input.audience === "string") rows.push({ label: "Audience", value: input.audience });
  if (typeof input.difficulty === "string") rows.push({ label: "Difficulty", value: input.difficulty });
  if (typeof input.tone === "string") rows.push({ label: "Tone", value: input.tone });
  rows.push({ label: "Content preview", value: truncateContent(content) });

  return {
    title: `Update ${contentType}`,
    subtitle: lessonTitle,
    rows,
    actionLabel: "Save content",
    reversibilityNote: "This replaces the lesson's current content — you can regenerate or manually edit it again later.",
  };
}

/**
 * `generate_assessment` — ALWAYS creates a brand-new assessment lesson (narrowed this phase; see
 * `ai/tools/courses.ts`'s doc comment — modifying an existing one is `update_assessment`, below).
 * Shows up to the first 5 questions with type/choices/correct answer, then a count of any remainder
 * rather than dumping all 30 into the card (Phase 10: "design a useful preview/truncation
 * mechanism"). `execution.input.questions` still carries every question — the preview only affects
 * what's DISPLAYED, never what gets created on confirm.
 */
const ASSESSMENT_PREVIEW_MAX_QUESTIONS = 5;

interface QuestionLike {
  type?: string;
  text?: string;
  choices?: string[];
  correctAnswer?: string;
  explanation?: string;
}

export function describeGenerateAssessmentProposal(input: Record<string, unknown>): ProposalDetail {
  const title = typeof input.title === "string" ? input.title : "this assessment";
  const questions = Array.isArray(input.questions) ? (input.questions as QuestionLike[]) : [];

  const rows = questions.slice(0, ASSESSMENT_PREVIEW_MAX_QUESTIONS).map((q, i) => ({
    label: `Q${i + 1} (${q.type})`,
    value: `${q.text}${q.choices ? ` — [${q.choices.join(" / ")}]` : ""} — Answer: ${q.correctAnswer}`,
  }));
  if (questions.length > ASSESSMENT_PREVIEW_MAX_QUESTIONS) {
    rows.push({ label: "…", value: `${questions.length - ASSESSMENT_PREVIEW_MAX_QUESTIONS} more question(s), not shown here — all will be saved exactly as generated.` });
  }

  return {
    title: `New ${typeof input.assessmentType === "string" ? input.assessmentType : "assessment"}`,
    subtitle: `${title} — ${questions.length} question${questions.length === 1 ? "" : "s"}`,
    rows: rows.length > 0 ? rows : [{ label: "Questions", value: "No questions specified" }],
    actionLabel: "Create assessment",
    reversibilityNote: "Created in the same draft state as the rest of the course — you can edit or regenerate it later.",
  };
}

/** Two questions are the same content, field-by-field — `explanation` normalized to `""` so an
 * absent explanation on both sides doesn't register as a difference. */
function questionEquals(a: QuestionLike, b: QuestionLike): boolean {
  if (a.type !== b.type || a.text !== b.text || a.correctAnswer !== b.correctAnswer || (a.explanation ?? "") !== (b.explanation ?? "")) {
    return false;
  }
  const ac = a.choices ?? [];
  const bc = b.choices ?? [];
  return ac.length === bc.length && ac.every((c, i) => c === bc[i]);
}

/**
 * `update_assessment` (AI Assessment Refinement & Editing phase) — the one update proposal in this
 * app that CAN show a trustworthy before/after (every other `describe*UpdateProposal` above
 * explicitly can't, and says why): `input.currentQuestions` is the model's own echo of what it just
 * read via `get_course_lesson_content`, not a value this component invents — same "echo, never
 * fabricate" rule `lessonTitle`/reorder tools' `title` fields already follow, just extended to a
 * whole array here. The diff below is a simple POSITIONAL comparison (index-by-index against
 * `currentQuestions`), matching how the spec's own examples refer to questions ("question 3",
 * "question 4") — not a content-aware/LCS diff, which would be more "correct" for a mid-list
 * insertion but is unnecessary complexity for what's meant to be a human-scannable summary; the full
 * proposed question list is always shown in full below it regardless of how the diff counts came out.
 */
export function describeUpdateAssessmentProposal(input: Record<string, unknown>): ProposalDetail {
  const title = typeof input.title === "string" ? input.title : "this assessment";
  const current = Array.isArray(input.currentQuestions) ? (input.currentQuestions as QuestionLike[]) : [];
  const proposed = Array.isArray(input.questions) ? (input.questions as QuestionLike[]) : [];
  const changeSummary = typeof input.changeSummary === "string" ? input.changeSummary : undefined;

  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;
  const maxLen = Math.max(current.length, proposed.length);
  for (let i = 0; i < maxLen; i++) {
    const c = current[i];
    const p = proposed[i];
    if (c && p) {
      if (questionEquals(c, p)) unchanged++;
      else changed++;
    } else if (p) {
      added++;
    } else {
      removed++;
    }
  }
  const diffParts = [
    ...(added > 0 ? [`${added} added`] : []),
    ...(removed > 0 ? [`${removed} removed`] : []),
    ...(changed > 0 ? [`${changed} changed`] : []),
    ...(unchanged > 0 ? [`${unchanged} unchanged`] : []),
  ];

  const rows = proposed.slice(0, ASSESSMENT_PREVIEW_MAX_QUESTIONS).map((q, i) => {
    const c = current[i];
    const status = !c ? " — new" : questionEquals(c, q) ? "" : " — changed";
    return {
      label: `Q${i + 1} (${q.type}${status})`,
      value: `${q.text}${q.choices ? ` — [${q.choices.join(" / ")}]` : ""} — Answer: ${q.correctAnswer}`,
    };
  });
  if (proposed.length > ASSESSMENT_PREVIEW_MAX_QUESTIONS) {
    rows.push({ label: "…", value: `${proposed.length - ASSESSMENT_PREVIEW_MAX_QUESTIONS} more question(s), not shown here — all will be saved exactly as proposed.` });
  }
  if (proposed.length < current.length) {
    rows.push({ label: "Removed", value: `${current.length - proposed.length} question(s) from the current set are not in the new set.` });
  }

  return {
    title: "Update assessment",
    subtitle: `${title} — ${current.length} → ${proposed.length} question${proposed.length === 1 ? "" : "s"}${diffParts.length > 0 ? ` (${diffParts.join(", ")})` : ""}${changeSummary ? ` · ${changeSummary}` : ""}`,
    rows: rows.length > 0 ? rows : [{ label: "Questions", value: "No questions specified" }],
    actionLabel: "Save changes",
    reversibilityNote:
      "This replaces the assessment's entire question set — you can edit or regenerate it again later. If the assessment changed since this proposal was created, confirming will fail safely and save nothing.",
  };
}

/**
 * `set_course_image`/`set_lesson_image` (AI Image Discovery & Course Asset Management Phase 1) —
 * every field read here is a display-only echo already present on `execution.input` (never
 * fabricated by this component, same rule every other describer above follows); see
 * `ai/tools/images.ts`'s own doc comment on why echoing these specific fields is safe. Shared by
 * both tools since their proposal shape is identical apart from which resource is being changed.
 */
function describeSetImageProposal(resourceLabel: "course" | "lesson", input: Record<string, unknown>): ProposalDetail {
  const title = typeof input.title === "string" ? input.title : null;
  const author = typeof input.author === "string" ? input.author : null;
  const authorUrl = typeof input.authorUrl === "string" ? input.authorUrl : null;
  const sourceUrl = typeof input.sourceUrl === "string" ? input.sourceUrl : null;
  const license = typeof input.license === "string" ? input.license : null;
  const licenseUrl = typeof input.licenseUrl === "string" ? input.licenseUrl : null;
  const imageUrl = typeof input.imageUrl === "string" ? input.imageUrl : "";

  const rows: { label: string; value: string }[] = [];
  if (author) rows.push({ label: "Photographer", value: author });
  rows.push({ label: "Source", value: "Unsplash" });
  if (license) rows.push({ label: "License", value: license });

  return {
    title: resourceLabel === "course" ? "Set course image" : "Set lesson image",
    subtitle: title ?? "Selected photo",
    rows,
    actionLabel: resourceLabel === "course" ? "Set course image" : "Set lesson image",
    reversibilityNote:
      resourceLabel === "course"
        ? "Replaces the course's current image — you can change it again later."
        : "Replaces any previously AI-selected image on this lesson (never a manually-added resource) — you can change it again later.",
    imagePreview: { imageUrl, title, author, authorUrl, sourceUrl, license, licenseUrl },
  };
}

export function describeSetCourseImageProposal(input: Record<string, unknown>): ProposalDetail {
  return describeSetImageProposal("course", input);
}

export function describeSetLessonImageProposal(input: Record<string, unknown>): ProposalDetail {
  return describeSetImageProposal("lesson", input);
}

/** Turns a raw tool execution's `toolName`/`input` into the human-readable proposal shape the
 * card renders — the frontend counterpart of `ai/routes.ts`'s `humanizeToolName`. One case per
 * mutating tool that exists; a new domain's mutating tools add a case here, not a generic fallback
 * that hides what's actually about to happen. */
export function describeProposal(execution: AiToolExecution): ProposalDetail {
  const input = execution.input as Record<string, unknown>;
  const formKey = typeof input.formKey === "string" ? input.formKey : "this form";

  if (execution.toolName === "create_form_field") {
    const options = Array.isArray(input.options) ? (input.options as string[]) : undefined;
    return {
      title: "Add field to form",
      subtitle: `Form: ${formKey}`,
      rows: [
        { label: "Field", value: String(input.label ?? "") },
        { label: "Type", value: String(input.fieldType ?? "") },
        { label: "Required", value: input.isRequired ? "Yes" : "No" },
        ...(options ? [{ label: "Options", value: options.join(", ") }] : []),
      ],
      actionLabel: "Create field",
      reversibilityNote: "You can edit or archive this field later — nothing about this is permanent.",
    };
  }

  if (execution.toolName === "update_form_field") {
    const archived = input.archived === true;
    const rows: { label: string; value: string }[] = [];
    if (input.label !== undefined) rows.push({ label: "New label", value: String(input.label) });
    if (input.fieldType !== undefined) rows.push({ label: "New type", value: String(input.fieldType) });
    if (input.isRequired !== undefined) rows.push({ label: "Required", value: input.isRequired ? "Yes" : "No" });
    if (archived) rows.push({ label: "Action", value: "Archive this field" });
    return {
      title: archived ? "Archive field" : "Update field",
      subtitle: `Form: ${formKey}`,
      rows: rows.length > 0 ? rows : [{ label: "Change", value: "No visible field changes detected" }],
      actionLabel: archived ? "Archive field" : "Update field",
      reversibilityNote: archived
        ? "Archiving hides this field from the form — it is not permanently deleted and can be restored by an admin."
        : "You can change this again later.",
    };
  }

  if (execution.toolName === "reorder_form_fields") {
    const fieldIds = Array.isArray(input.fieldIds) ? (input.fieldIds as string[]) : [];
    return {
      title: "Reorder fields",
      subtitle: `Form: ${formKey}`,
      rows: [{ label: "New order", value: `${fieldIds.length} field${fieldIds.length === 1 ? "" : "s"} repositioned` }],
      actionLabel: "Reorder fields",
      reversibilityNote: "You can reorder fields again at any time.",
    };
  }

  if (execution.toolName === "create_course_draft") {
    const modules = Array.isArray(input.modules) ? (input.modules as { title?: string }[]) : [];
    const duration = input.duration as { value?: number; unit?: string } | undefined;
    const objectives = Array.isArray(input.learningObjectives) ? (input.learningObjectives as string[]) : [];
    return {
      title: String(input.title ?? "New course"),
      subtitle: "Status: Draft (unpublished)",
      rows: [
        ...(input.description ? [{ label: "Description", value: String(input.description) }] : []),
        { label: "Category", value: String(input.category ?? "") },
        { label: "Delivery", value: String(input.deliveryMode ?? "") },
        ...(duration?.value ? [{ label: "Duration", value: `${duration.value} ${duration.unit ?? ""}` }] : []),
        ...(objectives.length > 0 ? [{ label: "Objectives", value: objectives.join("; ") }] : []),
        ...modules.map((m, i) => ({ label: `Module ${i + 1}`, value: m.title ?? "" })),
      ],
      actionLabel: "Create draft",
      reversibilityNote: "Created as a draft, unpublished course — nothing is visible to learners until you publish it, and you can edit or delete it freely before then.",
    };
  }

  if (execution.toolName === "create_course_module") {
    return {
      title: "Add module to course",
      subtitle: String(input.title ?? ""),
      rows: [...(input.description ? [{ label: "Description", value: String(input.description) }] : [])],
      actionLabel: "Add module",
      reversibilityNote: "You can edit, reorder, or delete this module later.",
    };
  }

  if (execution.toolName === "create_course_lesson") {
    return {
      title: "Add lesson to course",
      subtitle: String(input.title ?? ""),
      rows: [
        { label: "Type", value: String(input.type ?? "") },
        { label: "Placement", value: input.moduleId ? "Inside a module" : "Standalone (top-level)" },
      ],
      actionLabel: "Add lesson",
      reversibilityNote: "You can edit, move, or delete this lesson later.",
    };
  }

  if (execution.toolName === "update_course" || execution.toolName === "update_course_module" || execution.toolName === "update_course_lesson") {
    return describeUpdateProposal(execution.toolName, input);
  }

  if (execution.toolName === "reorder_course_modules" || execution.toolName === "reorder_course_lessons") {
    return describeReorderProposal(execution.toolName, input);
  }

  if (execution.toolName === "archive_course_module" || execution.toolName === "archive_course_lesson") {
    return describeArchiveProposal(execution.toolName, input);
  }

  if (execution.toolName === "generate_course_structure") {
    return describeGenerateProposal(input);
  }

  if (execution.toolName === "generate_lesson_content") {
    return describeGenerateLessonContentProposal(input);
  }

  if (execution.toolName === "generate_assessment") {
    return describeGenerateAssessmentProposal(input);
  }

  if (execution.toolName === "update_assessment") {
    return describeUpdateAssessmentProposal(input);
  }

  if (execution.toolName === "set_course_image") {
    return describeSetCourseImageProposal(input);
  }

  if (execution.toolName === "set_lesson_image") {
    return describeSetLessonImageProposal(input);
  }

  return {
    title: execution.toolName.replace(/_/g, " "),
    subtitle: "",
    rows: Object.entries(input).map(([label, value]) => ({ label, value: String(value) })),
    actionLabel: "Confirm",
    reversibilityNote: "",
  };
}
