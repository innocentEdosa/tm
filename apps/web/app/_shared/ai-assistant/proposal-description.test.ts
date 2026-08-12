import { describe, expect, it } from "vitest";
import {
  describeProposal,
  describeReorderProposal,
  describeArchiveProposal,
  describeUpdateProposal,
  describeGenerateProposal,
  describeGenerateLessonContentProposal,
  describeGenerateAssessmentProposal,
  describeUpdateAssessmentProposal,
  describeSetCourseImageProposal,
  describeSetLessonImageProposal,
} from "./proposal-description";
import type { AiToolExecution } from "@/lib/ai-api-client";

function execution(overrides: Partial<AiToolExecution>): AiToolExecution {
  return {
    id: "exec-1",
    conversationId: "conv-1",
    toolName: "unknown_tool",
    input: {},
    output: null,
    status: "pending_confirmation",
    mutating: true,
    error: null,
    createdAt: new Date().toISOString(),
    confirmedAt: null,
    expiresAt: null,
    ...overrides,
  };
}

describe("proposal-description — reorder proposals never show raw UUIDs when a title is available", () => {
  it("reorder_course_modules shows a numbered list of real titles, in the proposed order", () => {
    const detail = describeReorderProposal("reorder_course_modules", {
      courseId: "course-1",
      modules: [
        { id: "mod-c", title: "Compliance" },
        { id: "mod-a", title: "Introduction" },
        { id: "mod-b", title: "Security Awareness" },
      ],
    });
    expect(detail.title).toBe("Reorder modules");
    expect(detail.rows).toEqual([
      { label: "1.", value: "Compliance" },
      { label: "2.", value: "Introduction" },
      { label: "3.", value: "Security Awareness" },
    ]);
    // No row's value is a raw id — every row resolved to the human-readable title.
    for (const row of detail.rows) {
      expect(row.value).not.toMatch(/^mod-/);
    }
  });

  it("reorder_course_lessons shows the proposed lesson order for one module", () => {
    const detail = describeReorderProposal("reorder_course_lessons", {
      moduleId: "mod-b",
      lessons: [
        { id: "lesson-2", title: "Password Hygiene" },
        { id: "lesson-1", title: "Recognizing Phishing" },
      ],
    });
    expect(detail.title).toBe("Reorder lessons");
    expect(detail.rows).toEqual([
      { label: "1.", value: "Password Hygiene" },
      { label: "2.", value: "Recognizing Phishing" },
    ]);
  });

  it("falls back to the id only if a title is genuinely missing from input, never fabricating one", () => {
    const detail = describeReorderProposal("reorder_course_modules", { courseId: "c", modules: [{ id: "mod-x" }] });
    expect(detail.rows).toEqual([{ label: "1.", value: "mod-x" }]);
  });

  it("never claims a 'current order' — only ever shows what's actually in the trusted input", () => {
    const detail = describeReorderProposal("reorder_course_modules", { courseId: "c", modules: [{ id: "a", title: "A" }] });
    expect(detail.subtitle.toLowerCase()).not.toContain("current:");
    expect(detail.subtitle).toMatch(/current order was shown/i);
  });
});

describe("proposal-description — archive proposals identify the resource by name, explain reversibility, never claim deletion", () => {
  it("archive_course_module shows the module's real title and a non-destructive explanation", () => {
    const detail = describeArchiveProposal("archive_course_module", { moduleId: "mod-1", title: "Compliance" });
    expect(detail.title).toBe("Archive module");
    expect(detail.subtitle).toBe("Compliance");
    expect(detail.reversibilityNote).toMatch(/restored later/i);
    expect(detail.reversibilityNote).toMatch(/nothing is permanently deleted/i);
  });

  it("archive_course_lesson shows the lesson's real title and a non-destructive explanation", () => {
    const detail = describeArchiveProposal("archive_course_lesson", { lessonId: "lesson-1", title: "Recognizing Phishing" });
    expect(detail.title).toBe("Archive lesson");
    expect(detail.subtitle).toBe("Recognizing Phishing");
    expect(detail.reversibilityNote).toMatch(/restored later/i);
    expect(detail.reversibilityNote).toMatch(/nothing is permanently deleted/i);
  });
});

describe("proposal-description — generate_course_structure shows the whole plan without raw JSON or fabricated fields", () => {
  const samplePlan = {
    title: "Cybersecurity Awareness for New Employees",
    category: "Cybersecurity",
    deliveryMode: "self_paced",
    duration: { value: 4, unit: "weeks" },
    learningObjectives: ["Identify common security threats", "Recognize phishing attempts"],
    modules: [
      { title: "Security Fundamentals", lessons: [{ title: "What is cybersecurity?" }, { title: "Common security threats" }] },
      { title: "Passwords & Authentication", lessons: [{ title: "Password security" }, { title: "MFA" }] },
    ],
  };

  it("shows the course title, status, and a module/lesson count summary", () => {
    const detail = describeGenerateProposal(samplePlan);
    expect(detail.title).toBe("Cybersecurity Awareness for New Employees");
    expect(detail.subtitle).toMatch(/draft/i);
    expect(detail.subtitle).toMatch(/2 modules/);
    expect(detail.subtitle).toMatch(/4 lessons/);
  });

  it("shows one row per module, including that module's own lesson titles", () => {
    const detail = describeGenerateProposal(samplePlan);
    const moduleRow = detail.rows.find((r) => r.label === "Module 1");
    expect(moduleRow?.value).toContain("Security Fundamentals");
    expect(moduleRow?.value).toContain("What is cybersecurity?");
    expect(moduleRow?.value).toContain("Common security threats");
  });

  it("never fabricates a provider or cost when they weren't part of the plan", () => {
    const detail = describeGenerateProposal(samplePlan);
    expect(detail.rows.some((r) => r.label === "Provider")).toBe(false);
    expect(detail.rows.some((r) => r.label === "Cost")).toBe(false);
  });

  it("shows provider/cost only when they were actually part of the generated plan", () => {
    const detail = describeGenerateProposal({ ...samplePlan, provider: "Acme Learning", cost: 49.99 });
    expect(detail.rows.find((r) => r.label === "Provider")?.value).toBe("Acme Learning");
    expect(detail.rows.find((r) => r.label === "Cost")?.value).toBe("49.99");
  });

  it("action label is Create course, reversibility note explains draft status", () => {
    const detail = describeGenerateProposal(samplePlan);
    expect(detail.actionLabel).toBe("Create course");
    expect(detail.reversibilityNote).toMatch(/draft/i);
  });
});

describe("proposal-description — generate_lesson_content shows a preview without dumping raw content or fabricating a before-value", () => {
  it("shows the real lesson title, content type, and a preview of the generated body", () => {
    const detail = describeGenerateLessonContentProposal({
      lessonId: "lesson-1",
      lessonTitle: "Recognizing Phishing",
      articleBody: "## Introduction\nPhishing is a common attack vector...",
      audience: "new employees",
      difficulty: "beginner",
    });
    expect(detail.title).toBe("Update article");
    expect(detail.subtitle).toBe("Recognizing Phishing");
    expect(detail.rows.find((r) => r.label === "Audience")?.value).toBe("new employees");
    expect(detail.rows.find((r) => r.label === "Difficulty")?.value).toBe("beginner");
    expect(detail.rows.find((r) => r.label === "Content preview")?.value).toContain("Phishing is a common attack vector");
  });

  it("truncates very long content in the preview but the full text is still whatever the caller passed through execution.input", () => {
    const longBody = "x".repeat(2000);
    const detail = describeGenerateLessonContentProposal({ lessonId: "l1", lessonTitle: "Long Lesson", articleBody: longBody });
    const previewRow = detail.rows.find((r) => r.label === "Content preview")!;
    expect(previewRow.value.length).toBeLessThan(longBody.length);
    expect(previewRow.value).toMatch(/2000 characters total/);
  });

  it("identifies video vs live_class content correctly", () => {
    expect(describeGenerateLessonContentProposal({ lessonId: "l1", lessonTitle: "V", videoScript: "Scene 1..." }).title).toBe("Update video script");
    expect(describeGenerateLessonContentProposal({ lessonId: "l1", lessonTitle: "L", liveClassAgenda: "Agenda..." }).title).toBe("Update live class agenda");
  });
});

describe("proposal-description — generate_assessment shows question previews without raw JSON, truncates long question sets", () => {
  const questions = Array.from({ length: 8 }, (_, i) => ({ type: "multiple_choice", text: `Question ${i + 1}?`, choices: ["A", "B", "C"], correctAnswer: "A" }));

  it("new assessment: shows type, title, and question count", () => {
    const detail = describeGenerateAssessmentProposal({ moduleId: "m1", title: "Phishing Quiz", assessmentType: "test", questions: questions.slice(0, 3) });
    expect(detail.title).toBe("New test");
    expect(detail.subtitle).toBe("Phishing Quiz — 3 questions");
    expect(detail.actionLabel).toBe("Create assessment");
  });

  it("always creates a new assessment — there is no lessonId/regenerate branch (moved to update_assessment)", () => {
    const detail = describeGenerateAssessmentProposal({ moduleId: "m1", title: "Phishing Quiz", assessmentType: "assignment", questions: questions.slice(0, 2) });
    expect(detail.title).toBe("New assignment");
    expect(detail.actionLabel).toBe("Create assessment");
  });

  it("previews only the first 5 questions, noting how many more exist — all still in execution.input", () => {
    const detail = describeGenerateAssessmentProposal({ moduleId: "m1", title: "Big Quiz", assessmentType: "test", questions });
    const questionRows = detail.rows.filter((r) => r.label.startsWith("Q"));
    expect(questionRows).toHaveLength(5);
    expect(detail.rows.find((r) => r.label === "…")?.value).toMatch(/3 more question/);
  });

  it("each shown question includes its answer, never just the bare question text", () => {
    const detail = describeGenerateAssessmentProposal({ moduleId: "m1", title: "Quiz", assessmentType: "test", questions: questions.slice(0, 1) });
    expect(detail.rows[0].value).toContain("Answer: A");
  });
});

describe("proposal-description — update_assessment shows a real before/after diff, never fabricated", () => {
  const q = (text: string, correctAnswer = "A") => ({ type: "multiple_choice", text, choices: ["A", "B", "C"], correctAnswer });

  it("shows existing count, proposed count, and a diff summary", () => {
    const current = [q("Q1"), q("Q2"), q("Q3")];
    const proposed = [q("Q1"), q("Q2 revised"), q("Q3"), q("Q4")];
    const detail = describeUpdateAssessmentProposal({ lessonId: "l1", title: "Phishing Quiz", currentQuestions: current, questions: proposed });
    expect(detail.title).toBe("Update assessment");
    expect(detail.subtitle).toContain("Phishing Quiz");
    expect(detail.subtitle).toContain("3 → 4 questions");
    expect(detail.subtitle).toContain("1 added");
    expect(detail.subtitle).toContain("1 changed");
    expect(detail.subtitle).toContain("2 unchanged");
  });

  it("marks a changed question and a brand-new question distinctly in the row labels", () => {
    const current = [q("Q1"), q("Q2")];
    const proposed = [q("Q1"), q("Q2 revised"), q("Q3 new")];
    const detail = describeUpdateAssessmentProposal({ lessonId: "l1", title: "Quiz", currentQuestions: current, questions: proposed });
    expect(detail.rows[0].label).toBe("Q1 (multiple_choice)");
    expect(detail.rows[1].label).toBe("Q2 (multiple_choice — changed)");
    expect(detail.rows[2].label).toBe("Q3 (multiple_choice — new)");
  });

  it("notes removed questions when the proposed set is shorter", () => {
    const current = [q("Q1"), q("Q2"), q("Q3")];
    const proposed = [q("Q1"), q("Q2")];
    const detail = describeUpdateAssessmentProposal({ lessonId: "l1", title: "Quiz", currentQuestions: current, questions: proposed });
    expect(detail.subtitle).toContain("1 removed");
    expect(detail.rows.find((r) => r.label === "Removed")?.value).toMatch(/1 question/);
  });

  it("first-time population from an empty currentQuestions shows everything as new, not fabricated as changed", () => {
    const detail = describeUpdateAssessmentProposal({ lessonId: "l1", title: "Quiz", currentQuestions: [], questions: [q("Q1"), q("Q2")] });
    expect(detail.subtitle).toContain("0 → 2 questions");
    expect(detail.subtitle).toContain("2 added");
    expect(detail.rows[0].label).toBe("Q1 (multiple_choice — new)");
  });

  it("includes an optional changeSummary for display only", () => {
    const detail = describeUpdateAssessmentProposal({ lessonId: "l1", title: "Quiz", currentQuestions: [q("Q1")], questions: [q("Q1", "B")], changeSummary: "Made harder" });
    expect(detail.subtitle).toContain("Made harder");
  });

  it("action label and reversibility note reflect the fail-safe staleness behavior", () => {
    const detail = describeUpdateAssessmentProposal({ lessonId: "l1", title: "Quiz", currentQuestions: [q("Q1")], questions: [q("Q1")] });
    expect(detail.actionLabel).toBe("Save changes");
    expect(detail.reversibilityNote).toMatch(/fail safely/i);
  });
});

describe("proposal-description — set_course_image / set_lesson_image show a real preview and attribution, never fabricated", () => {
  const input = {
    courseId: "c1",
    providerImageId: "abc123",
    imageUrl: "https://images.unsplash.com/photo-abc123",
    previewUrl: "https://images.unsplash.com/photo-abc123?w=200",
    title: "Team collaborating around a table",
    author: "Jane Doe",
    authorUrl: "https://unsplash.com/@janedoe",
    sourceUrl: "https://unsplash.com/photos/abc123",
    license: "Unsplash License",
    licenseUrl: "https://unsplash.com/license",
  };

  it("course image: title, subtitle, and image preview reflect the echoed candidate", () => {
    const detail = describeSetCourseImageProposal(input);
    expect(detail.title).toBe("Set course image");
    expect(detail.subtitle).toBe("Team collaborating around a table");
    expect(detail.imagePreview).toEqual({
      imageUrl: input.imageUrl,
      title: input.title,
      author: input.author,
      authorUrl: input.authorUrl,
      sourceUrl: input.sourceUrl,
      license: input.license,
      licenseUrl: input.licenseUrl,
    });
    expect(detail.rows).toEqual([
      { label: "Photographer", value: "Jane Doe" },
      { label: "Source", value: "Unsplash" },
      { label: "License", value: "Unsplash License" },
    ]);
    expect(detail.actionLabel).toBe("Set course image");
  });

  it("lesson image: distinct title/reversibility note, notes only a prior AI-selected image is replaced", () => {
    const detail = describeSetLessonImageProposal(input);
    expect(detail.title).toBe("Set lesson image");
    expect(detail.reversibilityNote).toMatch(/never a manually-added resource/i);
  });

  it("falls back gracefully when optional attribution fields are absent", () => {
    const detail = describeSetCourseImageProposal({ courseId: "c1", providerImageId: "x", imageUrl: "https://images.unsplash.com/x" });
    expect(detail.subtitle).toBe("Selected photo");
    expect(detail.rows).toEqual([{ label: "Source", value: "Unsplash" }]);
    expect(detail.imagePreview?.author).toBeNull();
  });
});

describe("proposal-description — update proposals (regression)", () => {
  it("shows only the fields actually present, never a fabricated old value", () => {
    const detail = describeUpdateProposal("update_course", { courseId: "c", title: "New Title", cost: 79.99 });
    expect(detail.rows).toEqual([
      { label: "Title", value: "New Title" },
      { label: "Cost", value: "79.99" },
    ]);
  });
});

describe("proposal-description — describeProposal dispatches every known tool correctly (full regression)", () => {
  it("create_form_field", () => {
    const detail = describeProposal(execution({ toolName: "create_form_field", input: { formKey: "member", label: "Employee Number", fieldType: "text", isRequired: true } }));
    expect(detail.title).toBe("Add field to form");
  });

  it("update_form_field (archive branch)", () => {
    const detail = describeProposal(execution({ toolName: "update_form_field", input: { formKey: "member", fieldId: "f1", archived: true } }));
    expect(detail.title).toBe("Archive field");
  });

  it("reorder_form_fields", () => {
    const detail = describeProposal(execution({ toolName: "reorder_form_fields", input: { formKey: "member", fieldIds: ["a", "b"] } }));
    expect(detail.title).toBe("Reorder fields");
  });

  it("create_course_draft", () => {
    const detail = describeProposal(execution({ toolName: "create_course_draft", input: { title: "New Course", category: "Security", deliveryMode: "self_paced" } }));
    expect(detail.title).toBe("New Course");
    expect(detail.subtitle).toMatch(/draft/i);
  });

  it("create_course_module", () => {
    const detail = describeProposal(execution({ toolName: "create_course_module", input: { courseId: "c", title: "New Module" } }));
    expect(detail.title).toBe("Add module to course");
  });

  it("create_course_lesson", () => {
    const detail = describeProposal(execution({ toolName: "create_course_lesson", input: { courseId: "c", type: "article", title: "New Lesson" } }));
    expect(detail.title).toBe("Add lesson to course");
  });

  it("update_course / update_course_module / update_course_lesson", () => {
    expect(describeProposal(execution({ toolName: "update_course", input: { courseId: "c", title: "X" } })).title).toBe("Update course");
    expect(describeProposal(execution({ toolName: "update_course_module", input: { moduleId: "m", title: "X" } })).title).toBe("Update module");
    expect(describeProposal(execution({ toolName: "update_course_lesson", input: { lessonId: "l", title: "X" } })).title).toBe("Update lesson");
  });

  it("reorder_course_modules / reorder_course_lessons", () => {
    expect(describeProposal(execution({ toolName: "reorder_course_modules", input: { courseId: "c", modules: [{ id: "a", title: "A" }] } })).title).toBe("Reorder modules");
    expect(describeProposal(execution({ toolName: "reorder_course_lessons", input: { moduleId: "m", lessons: [{ id: "a", title: "A" }] } })).title).toBe("Reorder lessons");
  });

  it("archive_course_module / archive_course_lesson", () => {
    expect(describeProposal(execution({ toolName: "archive_course_module", input: { moduleId: "m", title: "M" } })).title).toBe("Archive module");
    expect(describeProposal(execution({ toolName: "archive_course_lesson", input: { lessonId: "l", title: "L" } })).title).toBe("Archive lesson");
  });

  it("generate_course_structure", () => {
    const detail = describeProposal(
      execution({
        toolName: "generate_course_structure",
        input: { title: "New Course", category: "Security", deliveryMode: "self_paced", duration: { value: 1, unit: "weeks" }, modules: [{ title: "M1", lessons: [{ title: "L1" }] }] },
      }),
    );
    expect(detail.title).toBe("New Course");
    expect(detail.actionLabel).toBe("Create course");
  });

  it("generate_lesson_content / generate_assessment / update_assessment", () => {
    expect(describeProposal(execution({ toolName: "generate_lesson_content", input: { lessonId: "l1", lessonTitle: "L", articleBody: "Body" } })).title).toBe("Update article");
    expect(describeProposal(execution({ toolName: "generate_assessment", input: { moduleId: "m1", title: "Quiz", assessmentType: "test", questions: [{ type: "true_false", text: "Q?", correctAnswer: "true" }] } })).title).toBe("New test");
    expect(
      describeProposal(
        execution({ toolName: "update_assessment", input: { lessonId: "l1", title: "Quiz", currentQuestions: [], questions: [{ type: "true_false", text: "Q?", correctAnswer: "true" }] } }),
      ).title,
    ).toBe("Update assessment");
  });

  it("set_course_image / set_lesson_image", () => {
    const input = { courseId: "c1", providerImageId: "abc", imageUrl: "https://images.unsplash.com/abc", previewUrl: "https://images.unsplash.com/abc?w=200" };
    expect(describeProposal(execution({ toolName: "set_course_image", input })).title).toBe("Set course image");
    expect(describeProposal(execution({ toolName: "set_lesson_image", input: { ...input, lessonId: "l1" } })).title).toBe("Set lesson image");
  });

  it("an unrecognized tool falls back to a generic (but non-hiding) description, never crashing", () => {
    const detail = describeProposal(execution({ toolName: "some_future_tool", input: { foo: "bar" } }));
    expect(detail.title).toBe("some future tool");
    expect(detail.rows).toEqual([{ label: "foo", value: "bar" }]);
  });
});
