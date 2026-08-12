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
 * AI Lesson Content & Assessment Generation phase — Phase 10's multi-turn scenarios, driven through
 * the real `POST /ai/conversations/:id/messages` route with a `ScriptedProvider`. Turn structure
 * matches every prior phase's own established rule: a non-mutating tool call costs TWO provider
 * calls in one HTTP turn (the call, then a text-only follow-up); a mutating call stops the turn
 * immediately with `pending_confirmation`.
 *
 * Once a mutating call is CONFIRMED (not just proposed), `reconstructHistory` attaches its REAL
 * structured output as a `role: "tool"` result on the next turn (the same mechanism proven in the
 * Course Editing/Organization phases) — this is what lets turn 3 in Scenario B below reliably pull
 * the lesson's real id/title/type from turn 2's own confirmed result, not from plain text.
 */

function confirmViaHttp(server: Awaited<ReturnType<typeof buildTestServer>>, tenantId: string, userId: string, executionId: string) {
  return server.inject({ method: "POST", url: `/ai/tool-executions/${executionId}/confirm`, headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId } });
}

function readLesson(tenantId: string, lessonId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.id, lessonId)));
}

describe("Lesson Content AI — multi-turn scenarios (Phase 10)", () => {
  afterEach(() => {
    __setAiProviderForTesting(new NotConfiguredProvider());
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("Scenario A — context resolution: discover the module, then the lesson, then generate content for it by position ('the second one')", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
    const server = await buildTestServer();
    try {
      const courseRes = await server.inject({
        method: "POST",
        url: "/tenant/courses",
        headers,
        payload: { title: "Security Course", category: "Security", deliveryMode: "self_paced", duration: { value: 1, unit: "hours" } },
      });
      const courseId = courseRes.json().data.id as string;
      const moduleRes = await server.inject({ method: "POST", url: `/tenant/courses/${courseId}/modules`, headers, payload: { title: "Phishing" } });
      const moduleId = moduleRes.json().data.id as string;
      const lesson1Res = await server.inject({ method: "POST", url: `/tenant/modules/${moduleId}/content-items`, headers, payload: { type: "article", title: "Intro", payload: { body: "placeholder" } } });
      const lesson2Res = await server.inject({ method: "POST", url: `/tenant/modules/${moduleId}/content-items`, headers, payload: { type: "article", title: "Advanced Tactics", payload: { body: "placeholder" } } });
      const lesson2Id = lesson2Res.json().data.id as string;
      void lesson1Res;

      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({ content: null, toolCalls: [{ id: "c1", name: "list_course_modules", arguments: { courseId } }], stopReason: "tool_use", usage: usage() }),
          () => ({ content: "Found the Phishing module.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
          (input) => {
            const toolResult = input.messages.find((m) => m.role === "tool");
            const found = (JSON.parse(toolResult!.content) as { id: string; title: string }[]).find((m) => m.title === "Phishing")!;
            return { content: null, toolCalls: [{ id: "c2", name: "list_course_lessons", arguments: { courseId, moduleId: found.id } }], stopReason: "tool_use", usage: usage() };
          },
          () => ({ content: "It has two lessons: Intro and Advanced Tactics.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
          (input) => {
            const toolResults = input.messages.filter((m) => m.role === "tool");
            const lessonsResult = toolResults.map((m) => { try { return JSON.parse(m.content); } catch { return null; } }).find((v) => Array.isArray(v) && v[0]?.type !== undefined);
            const lessons = (lessonsResult as { id: string; title: string; position: number }[]).slice().sort((a, b) => a.position - b.position);
            const second = lessons[1];
            return {
              content: null,
              toolCalls: [{ id: "c3", name: "generate_lesson_content", arguments: { lessonId: second.id, lessonTitle: second.title, articleBody: "# Advanced Phishing Tactics\nReal generated content." } }],
              stopReason: "tool_use",
              usage: usage(),
            };
          },
        ]),
      );

      const turn1 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "What modules does this course have?" } });
      expect(turn1.json().data.toolExecution.toolName).toBe("list_course_modules");

      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "List the lessons in the Phishing module." } });
      expect(turn2.json().data.toolExecution.toolName).toBe("list_course_lessons");

      const turn3 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Generate content for the second one." } });
      const execution = turn3.json().data.toolExecution;
      expect(execution.toolName).toBe("generate_lesson_content");
      expect(execution.input.lessonId).toBe(lesson2Id);

      await confirmViaHttp(server, tenantId, userId, execution.id);
      const [lesson] = await readLesson(tenantId, lesson2Id);
      expect((lesson.payload as { body: string }).body).toContain("Real generated content");
    } finally {
      await server.close();
    }
  });

  it("Scenario B — edit/regenerate flow: generate, refine twice, then create a quiz from it — identity retained across every confirmed turn", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
    const server = await buildTestServer();
    try {
      const courseRes = await server.inject({
        method: "POST",
        url: "/tenant/courses",
        headers,
        payload: { title: "Onboarding", category: "Onboarding", deliveryMode: "self_paced", duration: { value: 1, unit: "hours" } },
      });
      const courseId = courseRes.json().data.id as string;
      const moduleRes = await server.inject({ method: "POST", url: `/tenant/courses/${courseId}/modules`, headers, payload: { title: "Security Basics" } });
      const moduleId = moduleRes.json().data.id as string;
      const lessonRes = await server.inject({
        method: "POST",
        url: `/tenant/modules/${moduleId}/content-items`,
        headers,
        payload: { type: "article", title: "Phishing Basics", payload: { body: "placeholder" } },
      });
      const lessonId = lessonRes.json().data.id as string;

      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([
          // Turn 1: discover the lesson.
          () => ({ content: null, toolCalls: [{ id: "c1", name: "get_course_lesson_content", arguments: { lessonId } }], stopReason: "tool_use", usage: usage() }),
          () => ({ content: "Found the Phishing Basics lesson.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
          // Turn 2: first generation.
          (input) => {
            const toolResult = input.messages.find((m) => m.role === "tool");
            const found = JSON.parse(toolResult!.content) as { id: string; title: string };
            return { content: null, toolCalls: [{ id: "c2", name: "generate_lesson_content", arguments: { lessonId: found.id, lessonTitle: found.title, articleBody: "First draft content." } }], stopReason: "tool_use", usage: usage() };
          },
          // Turn 3: refine — pulls the real lessonId/title from turn 2's now-CONFIRMED structured result.
          (input) => {
            const toolResult = input.messages.find((m) => m.role === "tool");
            const priorLesson = JSON.parse(toolResult!.content) as { id: string; title: string };
            return {
              content: null,
              toolCalls: [{ id: "c3", name: "generate_lesson_content", arguments: { lessonId: priorLesson.id, lessonTitle: priorLesson.title, articleBody: "Beginner-friendly rewritten content.", difficulty: "beginner" } }],
              stopReason: "tool_use",
              usage: usage(),
            };
          },
          // Turn 4: add more examples — same pattern.
          (input) => {
            const toolResult = input.messages.find((m) => m.role === "tool");
            const priorLesson = JSON.parse(toolResult!.content) as { id: string; title: string };
            return {
              content: null,
              toolCalls: [{ id: "c4", name: "generate_lesson_content", arguments: { lessonId: priorLesson.id, lessonTitle: priorLesson.title, articleBody: "Beginner-friendly content with five worked examples." } }],
              stopReason: "tool_use",
              usage: usage(),
            };
          },
          // Turn 5: create a quiz from it — a NEW assessment lesson in the same module.
          () => ({
            content: null,
            toolCalls: [{ id: "c5", name: "generate_assessment", arguments: { moduleId, title: "Phishing Basics Quiz", assessmentType: "test", questions: [{ type: "true_false", text: "Phishing emails always look suspicious.", correctAnswer: "false" }] } }],
            stopReason: "tool_use",
            usage: usage(),
          }),
        ]),
      );

      const turn1 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "What's in the Phishing Basics lesson?" } });
      expect(turn1.json().data.toolExecution.toolName).toBe("get_course_lesson_content");

      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Generate the content for it." } });
      const turn2Execution = turn2.json().data.toolExecution;
      expect(turn2Execution.toolName).toBe("generate_lesson_content");
      expect(turn2Execution.input.lessonId).toBe(lessonId);
      const confirm2 = await confirmViaHttp(server, tenantId, userId, turn2Execution.id);
      expect(confirm2.statusCode).toBe(200);

      const turn3 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Make it more beginner friendly." } });
      const turn3Execution = turn3.json().data.toolExecution;
      expect(turn3Execution.input.lessonId).toBe(lessonId); // identity retained
      await confirmViaHttp(server, tenantId, userId, turn3Execution.id);

      const turn4 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Add more examples." } });
      const turn4Execution = turn4.json().data.toolExecution;
      expect(turn4Execution.input.lessonId).toBe(lessonId);
      await confirmViaHttp(server, tenantId, userId, turn4Execution.id);

      const turn5 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Now create a quiz from it." } });
      const turn5Execution = turn5.json().data.toolExecution;
      expect(turn5Execution.toolName).toBe("generate_assessment");
      await confirmViaHttp(server, tenantId, userId, turn5Execution.id);

      // The lesson reflects the LAST regeneration only (turn 4's content), not turn 2's or turn 3's.
      const [lesson] = await readLesson(tenantId, lessonId);
      expect((lesson.payload as { body: string }).body).toBe("Beginner-friendly content with five worked examples.");

      const [quiz] = await withTenantDb(tenantId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.title, "Phishing Basics Quiz")));
      expect(quiz.type).toBe("test");
      expect((quiz.payload as { questions: unknown[] }).questions).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("Scenario C — cross-domain guardrail: a Forms question under heavy lesson-content context still selects the Forms tool; an unsupported publish request is declined, not misrouted", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
    const server = await buildTestServer();
    try {
      const courseRes = await server.inject({
        method: "POST",
        url: "/tenant/courses",
        headers,
        payload: { title: "Course", category: "Security", deliveryMode: "self_paced", duration: { value: 1, unit: "hours" } },
      });
      const courseId = courseRes.json().data.id as string;
      const moduleRes = await server.inject({ method: "POST", url: `/tenant/courses/${courseId}/modules`, headers, payload: { title: "Module" } });
      const moduleId = moduleRes.json().data.id as string;
      const lessonRes = await server.inject({
        method: "POST",
        url: `/tenant/modules/${moduleId}/content-items`,
        headers,
        payload: { type: "article", title: "Lesson", payload: { body: "placeholder" } },
      });
      const lessonId = lessonRes.json().data.id as string;

      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([() => ({ content: null, toolCalls: [{ id: "c1", name: "generate_lesson_content", arguments: { lessonId, lessonTitle: "Lesson", articleBody: "Content" } }], stopReason: "tool_use", usage: usage() })]),
      );
      const turn1 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Generate content for this lesson." } });
      expect(turn1.json().data.toolExecution.toolName).toBe("generate_lesson_content");

      __setAiProviderForTesting(
        new ScriptedProvider([() => ({ content: null, toolCalls: [{ id: "c2", name: "list_form_fields", arguments: { formKey: "member" } }], stopReason: "tool_use", usage: usage() }), () => ({ content: "Here are the member form's fields.", toolCalls: [], stopReason: "end_turn", usage: usage() })]),
      );
      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "What fields does the member form have?" } });
      expect(turn2.json().data.toolExecution.toolName).toBe("list_form_fields");

      __setAiProviderForTesting(
        new ScriptedProvider([() => ({ content: "I can't publish a lesson or course — that capability isn't available yet. I can help generate or edit content instead.", toolCalls: [], stopReason: "end_turn", usage: usage() })]),
      );
      const turn3 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Publish this lesson." } });
      expect(turn3.statusCode).toBe(200);
      expect(turn3.json().data.toolExecution).toBeNull();
      expect(turn3.json().data.message.content).toMatch(/publish/i);
    } finally {
      await server.close();
    }
  });
});
