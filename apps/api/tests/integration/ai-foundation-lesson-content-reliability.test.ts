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
import { listTools } from "../../src/ai/tool-registry";
import "../../src/ai/tools";

/**
 * Lesson Content Reliability Fix — regression tests for a real, reproduced-live bug: asking the AI
 * to "include clear content for all the article lessons" (or a similarly multi-lesson-implying
 * request) produced a `generate_lesson_content` call with a correct `lessonId`/`title` but NO
 * `articleBody` at all, tripping the tool's `.refine()` and surfacing as a bare "Invalid tool input"
 * 400 with nothing persisted — reproducible twice in a row (confirmed live against real OpenAI, see
 * this fix's final report), because the failure left zero trace in the conversation for the model to
 * learn from on retry.
 *
 * Root cause: NOT wrong tool selection, NOT a too-ambiguous schema, and NOT a route/provider
 * transformation bug — the model correctly picked `generate_lesson_content` and correctly resolved
 * `lessonId`, but omitted the required content field specifically when handling a multi-lesson
 * request (never for a single-lesson one). Fixed by (1) reordering the schema so content fields are
 * declared first and are described as REQUIRED-with-a-concrete-value, never omittable, (2) telling
 * the model explicitly, in the tool's own description, to handle a multi-lesson request one lesson
 * per turn (matching the real architectural limit that only one tool call is ever acted on per
 * turn), and (3) making a propose-time schema failure a recoverable, persisted turn instead of a
 * dead end — see `ai/routes.ts`'s `handleToolInputInvalid`.
 */

function confirmViaHttp(server: Awaited<ReturnType<typeof buildTestServer>>, tenantId: string, userId: string, executionId: string) {
  return server.inject({ method: "POST", url: `/ai/tool-executions/${executionId}/confirm`, headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId } });
}

function readLesson(tenantId: string, lessonId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.id, lessonId)));
}

async function seedCourseWithArticles(server: Awaited<ReturnType<typeof buildTestServer>>, headers: Record<string, string>) {
  const courseRes = await server.inject({
    method: "POST",
    url: "/tenant/courses",
    headers,
    payload: { title: "Servant Leadership Fundamentals", category: "Leadership", deliveryMode: "self_paced", duration: { value: 3, unit: "hours" } },
  });
  const courseId = courseRes.json().data.id as string;
  const moduleRes = await server.inject({ method: "POST", url: `/tenant/courses/${courseId}/modules`, headers, payload: { title: "Introduction to Servant Leadership" } });
  const moduleId = moduleRes.json().data.id as string;
  const titles = ["What is Servant Leadership?", "Core Principles", "Leading by Example"];
  const lessonIds: string[] = [];
  for (const title of titles) {
    const res = await server.inject({ method: "POST", url: `/tenant/modules/${moduleId}/content-items`, headers, payload: { type: "article", title, payload: { body: "TODO" } } });
    lessonIds.push(res.json().data.id as string);
  }
  return { courseId, moduleId, lessonIds, titles };
}

describe("Lesson Content Reliability Fix — A: content for ALL article lessons, one valid call per turn", () => {
  afterEach(() => {
    __setAiProviderForTesting(new NotConfiguredProvider());
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("generates valid, complete articleBody for every article lesson across sequential turns — never an invalid tool call", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
    const server = await buildTestServer();
    try {
      const { courseId, moduleId, lessonIds, titles } = await seedCourseWithArticles(server, headers);
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({ content: null, toolCalls: [{ id: "c1", name: "list_course_lessons", arguments: { courseId, moduleId } }], stopReason: "tool_use", usage: usage() }),
          () => ({ content: "There are three article lessons.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
          // One valid, COMPLETE generate_lesson_content call per turn — exactly the corrected
          // behavior; a real model batching several lessons into one malformed call is what this
          // fix prevents via the tool's own description, not something this scripted test can force,
          // but this proves the application-side contract (one full proposal per lesson) works.
          () => ({ content: null, toolCalls: [{ id: "c2", name: "generate_lesson_content", arguments: { lessonId: lessonIds[0], lessonTitle: titles[0], articleBody: "Full content for lesson 1." } }], stopReason: "tool_use", usage: usage() }),
          () => ({ content: null, toolCalls: [{ id: "c3", name: "generate_lesson_content", arguments: { lessonId: lessonIds[1], lessonTitle: titles[1], articleBody: "Full content for lesson 2." } }], stopReason: "tool_use", usage: usage() }),
          () => ({ content: null, toolCalls: [{ id: "c4", name: "generate_lesson_content", arguments: { lessonId: lessonIds[2], lessonTitle: titles[2], articleBody: "Full content for lesson 3." } }], stopReason: "tool_use", usage: usage() }),
        ]),
      );

      await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Include clear content for all the article lessons." } });

      for (let i = 0; i < 3; i++) {
        const turn = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Continue." } });
        const execution = turn.json().data.toolExecution;
        expect(turn.statusCode).toBe(200);
        expect(execution.toolName).toBe("generate_lesson_content");
        expect(execution.status).toBe("pending_confirmation"); // never "failed" / no 400
        expect(execution.input.articleBody).toBeTruthy();
        await confirmViaHttp(server, tenantId, userId, execution.id);
      }

      for (let i = 0; i < 3; i++) {
        const [lesson] = await readLesson(tenantId, lessonIds[i]);
        expect((lesson.payload as { body: string }).body).toBe(`Full content for lesson ${i + 1}.`);
      }
    } finally {
      await server.close();
    }
  });
});

describe("Lesson Content Reliability Fix — B/E: module → first lesson resolution, never a guessed UUID", () => {
  afterEach(() => {
    __setAiProviderForTesting(new NotConfiguredProvider());
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("resolves the module by name, then the first lesson by position, then proposes valid content — IDs traced from real tool results only", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
    const server = await buildTestServer();
    try {
      const { courseId, moduleId, lessonIds } = await seedCourseWithArticles(server, headers);
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([
          // Turn 1 (read, non-mutating): the call, then its follow-up synthesis — 2 scripted calls.
          () => ({ content: null, toolCalls: [{ id: "c1", name: "list_course_modules", arguments: { courseId } }], stopReason: "tool_use", usage: usage() }),
          (input) => {
            const toolResult = input.messages.find((m) => m.role === "tool");
            const modules = JSON.parse(toolResult!.content) as { id: string; title: string }[];
            const found = modules.find((m) => m.title === "Introduction to Servant Leadership")!;
            expect(found.id).toBe(moduleId); // never guessed — the real id, from the real tool result
            return { content: `Found it: ${found.id}`, toolCalls: [], stopReason: "end_turn", usage: usage() };
          },
          // Turn 2 (read, non-mutating): same pattern.
          () => ({ content: null, toolCalls: [{ id: "c2", name: "list_course_lessons", arguments: { courseId, moduleId } }], stopReason: "tool_use", usage: usage() }),
          (input) => {
            const toolResults = input.messages.filter((m) => m.role === "tool");
            const lessonsResult = toolResults.map((m) => { try { return JSON.parse(m.content); } catch { return null; } }).find((v) => Array.isArray(v) && v[0]?.type !== undefined);
            const lessons = (lessonsResult as { id: string; title: string; position: number }[]).slice().sort((a, b) => a.position - b.position);
            expect(lessons[0].id).toBe(lessonIds[0]); // the real first lesson, never invented
            return { content: "The first lesson is identified.", toolCalls: [], stopReason: "end_turn", usage: usage() };
          },
          // Turn 3 (mutating): stops immediately, one scripted call.
          () => ({
            content: null,
            toolCalls: [{ id: "c3", name: "generate_lesson_content", arguments: { lessonId: lessonIds[0], lessonTitle: "What is Servant Leadership?", articleBody: "Expanded content for the first lesson." } }],
            stopReason: "tool_use",
            usage: usage(),
          }),
        ]),
      );

      await server.inject({
        method: "POST",
        url: `/ai/conversations/${conversationId}/messages`,
        headers,
        payload: { content: "On the introduction to servant leadership module, include more lesson content in the first lesson.", context: { courseId } },
      });
      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Continue." } });
      const turn3 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Continue." } });

      expect(turn2.json().data.toolExecution.toolName).toBe("list_course_lessons");
      const execution = turn3.json().data.toolExecution;
      expect(execution.toolName).toBe("generate_lesson_content");
      expect(execution.input.lessonId).toBe(lessonIds[0]);
      expect(execution.input.articleBody).toBeTruthy();
      expect(execution.status).toBe("pending_confirmation");

      await confirmViaHttp(server, tenantId, userId, execution.id);
      const [lesson] = await readLesson(tenantId, lessonIds[0]);
      expect((lesson.payload as { body: string }).body).toBe("Expanded content for the first lesson.");
    } finally {
      await server.close();
    }
  });
});

describe("Lesson Content Reliability Fix — C/F: article generation, confirmation-gated", () => {
  afterEach(() => {
    __setAiProviderForTesting(new NotConfiguredProvider());
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("a valid articleBody call succeeds, writes nothing before confirmation, writes exactly the right lesson after", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
    const server = await buildTestServer();
    try {
      const { lessonIds, titles } = await seedCourseWithArticles(server, headers);
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([() => ({ content: null, toolCalls: [{ id: "c1", name: "generate_lesson_content", arguments: { lessonId: lessonIds[0], lessonTitle: titles[0], articleBody: "Real content." } }], stopReason: "tool_use", usage: usage() })]),
      );

      const turn = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Generate content for the first lesson." } });
      const execution = turn.json().data.toolExecution;
      expect(execution.status).toBe("pending_confirmation");

      const [beforeConfirm] = await readLesson(tenantId, lessonIds[0]);
      expect((beforeConfirm.payload as { body: string }).body).toBe("TODO"); // untouched pre-confirmation

      await confirmViaHttp(server, tenantId, userId, execution.id);
      const [afterConfirm] = await readLesson(tenantId, lessonIds[0]);
      expect((afterConfirm.payload as { body: string }).body).toBe("Real content.");

      // The other two lessons were never touched.
      const [other1] = await readLesson(tenantId, lessonIds[1]);
      const [other2] = await readLesson(tenantId, lessonIds[2]);
      expect((other1.payload as { body: string }).body).toBe("TODO");
      expect((other2.payload as { body: string }).body).toBe("TODO");
    } finally {
      await server.close();
    }
  });
});

describe("Lesson Content Reliability Fix — D: an invalid model call is recoverable, not a dead end", () => {
  afterEach(() => {
    __setAiProviderForTesting(new NotConfiguredProvider());
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("a call missing articleBody is recorded as a real, visible failed turn — HTTP 200, not a bare 400 — and the model can recover on the next turn", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
    const server = await buildTestServer();
    try {
      const { lessonIds, titles } = await seedCourseWithArticles(server, headers);
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([
          // Reproduces the exact live failure: correct lessonId/title, no content field at all.
          () => ({ content: null, toolCalls: [{ id: "c1", name: "generate_lesson_content", arguments: { lessonId: lessonIds[0], lessonTitle: titles[0], tone: "clear and practical" } }], stopReason: "tool_use", usage: usage() }),
          // The corrected retry — the model is expected to recover, not repeat the same mistake.
          () => ({ content: null, toolCalls: [{ id: "c2", name: "generate_lesson_content", arguments: { lessonId: lessonIds[0], lessonTitle: titles[0], articleBody: "Corrected complete content." } }], stopReason: "tool_use", usage: usage() }),
        ]),
      );

      const badTurn = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Generate content for the first lesson." } });
      expect(badTurn.statusCode).toBe(200); // not a bare 400 — this is the actual bug fix
      const badBody = badTurn.json();
      expect(badBody.success).toBe(true);
      expect(badBody.data.toolExecution.status).toBe("failed");
      expect(badBody.data.toolExecution.toolName).toBe("generate_lesson_content");
      expect(badBody.data.toolExecution.error).toMatch(/articleBody/i);
      expect(badBody.data.message.content).toMatch(/incomplete or invalid/i);
      expect(badBody.data.message.toolExecutionId).toBe(badBody.data.toolExecution.id);

      // Nothing was written for the failed attempt.
      const [afterBad] = await readLesson(tenantId, lessonIds[0]);
      expect((afterBad.payload as { body: string }).body).toBe("TODO");

      // The failed attempt is REAL conversation history now (not silently dropped) — reconstructHistory
      // replays it as the model's own prior message on the next turn.
      const historyRes = await server.inject({ method: "GET", url: `/ai/conversations/${conversationId}`, headers });
      const messages = historyRes.json().data.messages as { role: string; content: string }[];
      expect(messages.some((m) => m.role === "assistant" && /incomplete or invalid/i.test(m.content))).toBe(true);

      // Retry with a corrected call succeeds normally.
      const goodTurn = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Try again with the full content included." } });
      const goodExecution = goodTurn.json().data.toolExecution;
      expect(goodExecution.status).toBe("pending_confirmation");
      expect(goodExecution.input.articleBody).toBe("Corrected complete content.");
      await confirmViaHttp(server, tenantId, userId, goodExecution.id);

      const [afterGood] = await readLesson(tenantId, lessonIds[0]);
      expect((afterGood.payload as { body: string }).body).toBe("Corrected complete content.");
    } finally {
      await server.close();
    }
  });

  it("the raw Zod issues are preserved in the failed execution row, never hidden", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
    const server = await buildTestServer();
    try {
      const { lessonIds, titles } = await seedCourseWithArticles(server, headers);
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({ content: null, toolCalls: [{ id: "c1", name: "generate_lesson_content", arguments: { lessonId: lessonIds[0], lessonTitle: titles[0], articleBody: "A", videoScript: "B" } }], stopReason: "tool_use", usage: usage() }),
        ]),
      );

      const turn = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Generate content for the first lesson." } });
      const execution = turn.json().data.toolExecution;
      expect(execution.status).toBe("failed");
      expect(execution.error).toMatch(/exactly ONE/i);
      // The full, real (invalid) arguments are preserved too — never discarded.
      expect(execution.input.articleBody).toBe("A");
      expect(execution.input.videoScript).toBe("B");
    } finally {
      await server.close();
    }
  });
});

describe("Lesson Content Reliability Fix — G: wrong lesson type fails safely and clearly", () => {
  afterEach(() => {
    __setAiProviderForTesting(new NotConfiguredProvider());
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("attempting articleBody generation against a video lesson fails at confirm time with a clear message, writes nothing", async () => {
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
        payload: { title: "Video Course", category: "Test", deliveryMode: "self_paced", duration: { value: 1, unit: "hours" } },
      });
      const courseId = courseRes.json().data.id as string;
      const moduleRes = await server.inject({ method: "POST", url: `/tenant/courses/${courseId}/modules`, headers, payload: { title: "Module" } });
      const moduleId = moduleRes.json().data.id as string;
      const lessonRes = await server.inject({
        method: "POST",
        url: `/tenant/modules/${moduleId}/content-items`,
        headers,
        payload: { type: "video", title: "Intro Video", payload: { url: "https://videos.example.com/real.mp4" } },
      });
      const lessonId = lessonRes.json().data.id as string;
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([() => ({ content: null, toolCalls: [{ id: "c1", name: "generate_lesson_content", arguments: { lessonId, lessonTitle: "Intro Video", articleBody: "This is wrong — this lesson is a video." } }], stopReason: "tool_use", usage: usage() })]),
      );

      const turn = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Add article content to the intro video lesson." } });
      const execution = turn.json().data.toolExecution;
      expect(execution.status).toBe("pending_confirmation"); // valid per the SCHEMA — articleBody is well-formed

      const confirmed = await confirmViaHttp(server, tenantId, userId, execution.id);
      const confirmedBody = confirmed.json();
      expect(confirmedBody.data.status).toBe("failed"); // rejected at execute() time, against the REAL lesson type
      expect(confirmedBody.data.error).toMatch(/is a video — give videoScript/i);

      const [lesson] = await readLesson(tenantId, lessonId);
      expect(lesson.payload).toEqual({ url: "https://videos.example.com/real.mp4" }); // untouched
    } finally {
      await server.close();
    }
  });
});

describe("Lesson Content Reliability Fix — tool overlap: generate_lesson_content vs update_course_lesson descriptions", () => {
  it("both tools' descriptions distinguish AI-authored generation from human-dictated exact edits", () => {
    const generate = listTools().find((t) => t.name === "generate_lesson_content")!;
    const update = listTools().find((t) => t.name === "update_course_lesson")!;
    expect(generate.description).toMatch(/one lesson at a time|one lesson per turn|ONE LESSON AT A TIME/i);
    expect(update.description.toLowerCase()).toContain("generate_lesson_content");
  });
});
