import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { withTenantDb, closeTestPool } from "../helpers/pg";
import type { Db } from "../../src/db/client";
import { contentItems } from "../../src/db/schema/course-content";
import { __setAiProviderForTesting } from "../../src/ai/provider/invoke-ai";
import { ScriptedProvider, NotConfiguredProvider, usage } from "../helpers/scripted-ai-provider";
import "../../src/ai/tools";

/**
 * AI Assessment Refinement & Editing phase — the scenarios A-I named explicitly in the phase spec,
 * driven through the real `POST /ai/conversations/:id/messages` route with a `ScriptedProvider`,
 * same turn-mechanics precedent as every prior multi-turn file this session (a read tool costs two
 * scripted calls in one HTTP turn; a mutating call stops the turn immediately at
 * `pending_confirmation`).
 *
 * IMPORTANT — same caveat `ai-foundation-tool-selection.test.ts` already documents: a
 * `ScriptedProvider` proves the APPLICATION correctly threads tool identity/results/confirmation
 * through a conversation; it cannot prove a real model reliably picks `update_assessment` over
 * `generate_assessment` for "make this harder" — only live testing against the real provider can
 * (see this phase's final report). Scenario E (genuine ambiguity → clarification) is scripted as a
 * plain-text, no-tool-call response specifically to prove the plumbing supports that outcome without
 * forcing a tool call — not to claim a real model always asks.
 */

function confirmViaHttp(server: Awaited<ReturnType<typeof buildTestServer>>, tenantId: string, userId: string, executionId: string) {
  return server.inject({ method: "POST", url: `/ai/tool-executions/${executionId}/confirm`, headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId } });
}

function readLesson(tenantId: string, lessonId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.id, lessonId)));
}

async function setupCourseWithQuiz(tenantId: string, userId: string, server: Awaited<ReturnType<typeof buildTestServer>>, quizTitle: string, questions: unknown[]) {
  const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
  const courseRes = await server.inject({
    method: "POST",
    url: "/tenant/courses",
    headers,
    payload: { title: "Security Course", category: "Security", deliveryMode: "self_paced", duration: { value: 1, unit: "hours" } },
  });
  const courseId = courseRes.json().data.id as string;
  const moduleRes = await server.inject({ method: "POST", url: `/tenant/courses/${courseId}/modules`, headers, payload: { title: "Module" } });
  const moduleId = moduleRes.json().data.id as string;
  const quizRes = await server.inject({
    method: "POST",
    url: `/tenant/modules/${moduleId}/content-items`,
    headers,
    payload: { type: "test", title: quizTitle, payload: { questions } },
  });
  const lessonId = quizRes.json().data.id as string;
  const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;
  return { courseId, moduleId, lessonId, conversationId, headers };
}

const q = (text: string, correctAnswer = "true") => ({ type: "true_false" as const, text, correctAnswer });

describe("Assessment Editing AI — multi-turn scenarios", () => {
  afterEach(() => {
    __setAiProviderForTesting(new NotConfiguredProvider());
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("Scenario A — read then 'make it harder' targets the SAME assessment, never creates a second one", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const originalQuestions = [q("Phishing emails are always obvious.", "false")];
      const { lessonId, conversationId, headers } = await setupCourseWithQuiz(tenantId, userId, server, "Cybersecurity Quiz", originalQuestions);

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({ content: null, toolCalls: [{ id: "c1", name: "get_course_lesson_content", arguments: { lessonId } }], stopReason: "tool_use", usage: usage() }),
          () => ({ content: "Here are the current questions.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
          (input) => {
            const toolResult = input.messages.find((m) => m.role === "tool");
            const found = JSON.parse(toolResult!.content) as { id: string; title: string; payload: { questions: unknown[] } };
            return {
              content: null,
              toolCalls: [
                {
                  id: "c2",
                  name: "update_assessment",
                  arguments: { lessonId: found.id, title: found.title, currentQuestions: found.payload.questions, questions: [q("Phishing emails often look completely legitimate.", "true")], changeSummary: "Made harder" },
                },
              ],
              stopReason: "tool_use",
              usage: usage(),
            };
          },
        ]),
      );

      const turn1 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Show me the questions in the cybersecurity quiz." } });
      expect(turn1.json().data.toolExecution.toolName).toBe("get_course_lesson_content");

      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Make it harder." } });
      const turn2Execution = turn2.json().data.toolExecution;
      expect(turn2Execution.toolName).toBe("update_assessment");
      expect(turn2Execution.input.lessonId).toBe(lessonId);
      await confirmViaHttp(server, tenantId, userId, turn2Execution.id);

      // Exactly one lesson still exists with this title — no second quiz was created.
      const allQuizzes = await withTenantDb(tenantId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.title, "Cybersecurity Quiz")));
      expect(allQuizzes).toHaveLength(1);
      const [lesson] = await readLesson(tenantId, lessonId);
      expect((lesson.payload as { questions: { text: string }[] }).questions[0].text).toBe("Phishing emails often look completely legitimate.");
    } finally {
      await server.close();
    }
  });

  it("Scenario B — 'how many questions' then 'make it 10' proposes exactly 10 for the same assessment", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const originalQuestions = [q("Q1"), q("Q2"), q("Q3"), q("Q4"), q("Q5")];
      const { lessonId, conversationId, headers } = await setupCourseWithQuiz(tenantId, userId, server, "Quiz", originalQuestions);

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({ content: null, toolCalls: [{ id: "c1", name: "get_course_lesson_content", arguments: { lessonId } }], stopReason: "tool_use", usage: usage() }),
          () => ({ content: "There are 5 questions.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
          (input) => {
            const toolResult = input.messages.find((m) => m.role === "tool");
            const found = JSON.parse(toolResult!.content) as { id: string; title: string; payload: { questions: unknown[] } };
            const ten = Array.from({ length: 10 }, (_, i) => q(`Question ${i + 1}`));
            return {
              content: null,
              toolCalls: [{ id: "c2", name: "update_assessment", arguments: { lessonId: found.id, title: found.title, currentQuestions: found.payload.questions, questions: ten } }],
              stopReason: "tool_use",
              usage: usage(),
            };
          },
        ]),
      );

      await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "How many questions are in this quiz?" } });
      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Make it 10." } });
      const turn2Execution = turn2.json().data.toolExecution;
      expect(turn2Execution.toolName).toBe("update_assessment");
      expect(turn2Execution.input.questions).toHaveLength(10);
      await confirmViaHttp(server, tenantId, userId, turn2Execution.id);

      const [lesson] = await readLesson(tenantId, lessonId);
      expect((lesson.payload as { questions: unknown[] }).questions).toHaveLength(10);
    } finally {
      await server.close();
    }
  });

  it("Scenario C — 'make question 3 more difficult' modifies that position, preserves the rest", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const originalQuestions = [q("Q1"), q("Q2"), q("Q3 (easy)")];
      const { lessonId, conversationId, headers } = await setupCourseWithQuiz(tenantId, userId, server, "Quiz", originalQuestions);

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({ content: null, toolCalls: [{ id: "c1", name: "get_course_lesson_content", arguments: { lessonId } }], stopReason: "tool_use", usage: usage() }),
          () => ({ content: "Found it.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
          (input) => {
            const toolResult = input.messages.find((m) => m.role === "tool");
            const found = JSON.parse(toolResult!.content) as { id: string; title: string; payload: { questions: { text: string; type: string; correctAnswer: string }[] } };
            const current = found.payload.questions;
            const revised = [current[0], current[1], q("Q3 (much harder, scenario-based)")];
            return {
              content: null,
              toolCalls: [{ id: "c2", name: "update_assessment", arguments: { lessonId: found.id, title: found.title, currentQuestions: current, questions: revised } }],
              stopReason: "tool_use",
              usage: usage(),
            };
          },
        ]),
      );

      await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Show me this quiz." } });
      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Make question 3 more difficult." } });
      const turn2Execution = turn2.json().data.toolExecution;
      await confirmViaHttp(server, tenantId, userId, turn2Execution.id);

      const [lesson] = await readLesson(tenantId, lessonId);
      const questions = (lesson.payload as { questions: { text: string }[] }).questions;
      expect(questions.map((qq) => qq.text)).toEqual(["Q1", "Q2", "Q3 (much harder, scenario-based)"]);
    } finally {
      await server.close();
    }
  });

  it("Scenario D — 'regenerate this quiz' replaces the existing lesson's questions, never creates a second lesson", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const originalQuestions = [q("Old Q1"), q("Old Q2")];
      const { lessonId, conversationId, headers } = await setupCourseWithQuiz(tenantId, userId, server, "Quiz", originalQuestions);

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({ content: null, toolCalls: [{ id: "c1", name: "get_course_lesson_content", arguments: { lessonId } }], stopReason: "tool_use", usage: usage() }),
          () => ({ content: "Found it.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
          (input) => {
            const toolResult = input.messages.find((m) => m.role === "tool");
            const found = JSON.parse(toolResult!.content) as { id: string; title: string; payload: { questions: unknown[] } };
            return {
              content: null,
              toolCalls: [
                { id: "c2", name: "update_assessment", arguments: { lessonId: found.id, title: found.title, currentQuestions: found.payload.questions, questions: [q("Brand new Q1"), q("Brand new Q2"), q("Brand new Q3")], changeSummary: "Full regeneration" } },
              ],
              stopReason: "tool_use",
              usage: usage(),
            };
          },
        ]),
      );

      await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Show me this quiz." } });
      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Regenerate this quiz." } });
      const turn2Execution = turn2.json().data.toolExecution;
      expect(turn2Execution.toolName).toBe("update_assessment"); // never generate_assessment
      await confirmViaHttp(server, tenantId, userId, turn2Execution.id);

      const allQuizzes = await withTenantDb(tenantId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.title, "Quiz")));
      expect(allQuizzes).toHaveLength(1); // no second lesson

      const [lesson] = await readLesson(tenantId, lessonId);
      const questions = (lesson.payload as { questions: { text: string }[] }).questions;
      expect(questions).toHaveLength(3);
      expect(questions.some((qq) => qq.text.startsWith("Old"))).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("Scenario E — genuine ambiguity between two similarly-named quizzes: the app supports a clarifying, no-tool-call turn", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const courseRes = await server.inject({
        method: "POST",
        url: "/tenant/courses",
        headers,
        payload: { title: "Security Course", category: "Security", deliveryMode: "self_paced", duration: { value: 1, unit: "hours" } },
      });
      const courseId = courseRes.json().data.id as string;
      const moduleRes = await server.inject({ method: "POST", url: `/tenant/courses/${courseId}/modules`, headers, payload: { title: "Module" } });
      const moduleId = moduleRes.json().data.id as string;
      await server.inject({ method: "POST", url: `/tenant/modules/${moduleId}/content-items`, headers, payload: { type: "test", title: "Cybersecurity Basics Quiz", payload: { questions: [q("Q1")] } } });
      await server.inject({ method: "POST", url: `/tenant/modules/${moduleId}/content-items`, headers, payload: { type: "test", title: "Advanced Cybersecurity Quiz", payload: { questions: [q("Q1")] } } });
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({ content: null, toolCalls: [{ id: "c1", name: "list_course_lessons", arguments: { courseId, moduleId } }], stopReason: "tool_use", usage: usage() }),
          () => ({
            content: "There are two cybersecurity quizzes in this course — \"Cybersecurity Basics Quiz\" and \"Advanced Cybersecurity Quiz\". Which one would you like me to make harder?",
            toolCalls: [],
            stopReason: "end_turn",
            usage: usage(),
          }),
        ]),
      );

      const turn = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Make the cybersecurity quiz harder." } });
      const body = turn.json().data;
      expect(body.toolExecution.toolName).toBe("list_course_lessons"); // a read, never a guessed mutation
      expect(body.message.content).toMatch(/which one/i);

      // Nothing was written — both quizzes remain exactly as seeded.
      const quizzes = await withTenantDb(tenantId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.moduleId, moduleId)));
      for (const quiz of quizzes) {
        expect((quiz.payload as { questions: { text: string }[] }).questions).toEqual([{ type: "true_false", text: "Q1", correctAnswer: "true" }]);
      }
    } finally {
      await server.close();
    }
  });

  it("Scenario F — 'create a new quiz with 10 questions' uses generate_assessment, not update_assessment", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const courseRes = await server.inject({
        method: "POST",
        url: "/tenant/courses",
        headers,
        payload: { title: "Security Course", category: "Security", deliveryMode: "self_paced", duration: { value: 1, unit: "hours" } },
      });
      const courseId = courseRes.json().data.id as string;
      const moduleRes = await server.inject({ method: "POST", url: `/tenant/courses/${courseId}/modules`, headers, payload: { title: "Module" } });
      const moduleId = moduleRes.json().data.id as string;
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({
            content: null,
            toolCalls: [{ id: "c1", name: "generate_assessment", arguments: { moduleId, title: "Cybersecurity Quiz", assessmentType: "test", questions: Array.from({ length: 10 }, (_, i) => q(`Q${i + 1}`)) } }],
            stopReason: "tool_use",
            usage: usage(),
          }),
        ]),
      );

      const turn = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Create a new cybersecurity quiz with 10 questions." } });
      const execution = turn.json().data.toolExecution;
      expect(execution.toolName).toBe("generate_assessment");
      await confirmViaHttp(server, tenantId, userId, execution.id);

      const [created] = await withTenantDb(tenantId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.title, "Cybersecurity Quiz")));
      expect((created.payload as { questions: unknown[] }).questions).toHaveLength(10);
    } finally {
      await server.close();
    }
  });

  it("Scenario G — 'add two questions to the quiz' modifies the existing assessment via update_assessment", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const originalQuestions = [q("Q1"), q("Q2")];
      const { lessonId, conversationId, headers } = await setupCourseWithQuiz(tenantId, userId, server, "Quiz", originalQuestions);

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({ content: null, toolCalls: [{ id: "c1", name: "get_course_lesson_content", arguments: { lessonId } }], stopReason: "tool_use", usage: usage() }),
          () => ({ content: "Found it.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
          (input) => {
            const toolResult = input.messages.find((m) => m.role === "tool");
            const found = JSON.parse(toolResult!.content) as { id: string; title: string; payload: { questions: unknown[] } };
            return {
              content: null,
              toolCalls: [{ id: "c2", name: "update_assessment", arguments: { lessonId: found.id, title: found.title, currentQuestions: found.payload.questions, questions: [...found.payload.questions, q("Q3"), q("Q4")] } }],
              stopReason: "tool_use",
              usage: usage(),
            };
          },
        ]),
      );

      await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Show me the quiz." } });
      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Add two questions to the quiz." } });
      const turn2Execution = turn2.json().data.toolExecution;
      expect(turn2Execution.toolName).toBe("update_assessment");
      await confirmViaHttp(server, tenantId, userId, turn2Execution.id);

      const [lesson] = await readLesson(tenantId, lessonId);
      expect((lesson.payload as { questions: unknown[] }).questions).toHaveLength(4);
    } finally {
      await server.close();
    }
  });

  it("Scenario H — 'create another quiz for this course' uses generate_assessment", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const originalQuestions = [q("Q1")];
      const { moduleId, conversationId, headers } = await setupCourseWithQuiz(tenantId, userId, server, "Existing Quiz", originalQuestions);

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({
            content: null,
            toolCalls: [{ id: "c1", name: "generate_assessment", arguments: { moduleId, title: "Second Quiz", assessmentType: "test", questions: [q("New Q1")] } }],
            stopReason: "tool_use",
            usage: usage(),
          }),
        ]),
      );

      const turn = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Create another quiz for this course." } });
      const execution = turn.json().data.toolExecution;
      expect(execution.toolName).toBe("generate_assessment");
      await confirmViaHttp(server, tenantId, userId, execution.id);

      const allQuizzes = await withTenantDb(tenantId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.moduleId, moduleId)));
      expect(allQuizzes).toHaveLength(2); // the original + the new one, never overwritten
    } finally {
      await server.close();
    }
  });

  it("Scenario I — 'make it easier, then add two scenario questions' stays confirmation-gated per step, never autonomous", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const originalQuestions = [q("Hard Q1"), q("Hard Q2")];
      const { lessonId, conversationId, headers } = await setupCourseWithQuiz(tenantId, userId, server, "Quiz", originalQuestions);

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({ content: null, toolCalls: [{ id: "c1", name: "get_course_lesson_content", arguments: { lessonId } }], stopReason: "tool_use", usage: usage() }),
          () => ({ content: "Found it.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
          // Step 1 of the compound request: make it easier — ONE proposal, stops for confirmation.
          (input) => {
            const toolResult = input.messages.find((m) => m.role === "tool");
            const found = JSON.parse(toolResult!.content) as { id: string; title: string; payload: { questions: unknown[] } };
            return {
              content: null,
              toolCalls: [{ id: "c2", name: "update_assessment", arguments: { lessonId: found.id, title: found.title, currentQuestions: found.payload.questions, questions: [q("Easy Q1"), q("Easy Q2")], changeSummary: "Made easier" } }],
              stopReason: "tool_use",
              usage: usage(),
            };
          },
        ]),
      );

      await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Show me the quiz." } });
      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Make the quiz easier, then add two scenario questions." } });
      const turn2Execution = turn2.json().data.toolExecution;
      expect(turn2Execution.toolName).toBe("update_assessment");
      expect(turn2Execution.status).toBe("pending_confirmation"); // stopped here — the "then add two" part has NOT executed yet
      await confirmViaHttp(server, tenantId, userId, turn2Execution.id);

      const [afterStep1] = await readLesson(tenantId, lessonId);
      const step1Questions = (afterStep1.payload as { questions: { text: string }[] }).questions;
      expect(step1Questions.map((qq) => qq.text)).toEqual(["Easy Q1", "Easy Q2"]); // only step 1 applied — no autonomous chaining
    } finally {
      await server.close();
    }
  });
});

describe("Assessment Editing AI — cross-domain tool selection", () => {
  afterEach(() => {
    __setAiProviderForTesting(new NotConfiguredProvider());
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("'show me the form fields' selects a Forms tool, never a Courses assessment tool", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["forms.manage.tenant", "course.manage"]);
    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const formKey = `test_crossdomain_${randomUUID().slice(0, 8)}`;
      await server.inject({ method: "POST", url: "/platform/forms", headers, payload: { name: "Test Form", key: formKey, description: "d" } });
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({ content: null, toolCalls: [{ id: "c1", name: "list_form_fields", arguments: { formKey } }], stopReason: "tool_use", usage: usage() }),
          () => ({ content: "No fields yet.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
        ]),
      );

      const turn = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Show me the form fields.", context: { formKey } } });
      expect(turn.json().data.toolExecution.toolName).toBe("list_form_fields");
    } finally {
      await server.close();
    }
  });

  it("'update the course title' selects update_course, never update_assessment or a Forms tool", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const courseRes = await server.inject({
        method: "POST",
        url: "/tenant/courses",
        headers,
        payload: { title: "Old Title", category: "Security", deliveryMode: "self_paced", duration: { value: 1, unit: "hours" } },
      });
      const courseId = courseRes.json().data.id as string;
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([() => ({ content: null, toolCalls: [{ id: "c1", name: "update_course", arguments: { courseId, title: "New Title" } }], stopReason: "tool_use", usage: usage() })]),
      );

      const turn = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Update the course title to New Title.", context: { courseId } } });
      expect(turn.json().data.toolExecution.toolName).toBe("update_course");
    } finally {
      await server.close();
    }
  });
});
