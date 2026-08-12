import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { withTenantDb, closeTestPool } from "../helpers/pg";
import type { Db } from "../../src/db/client";
import { courses } from "../../src/db/schema/courses";
import { courseModules, contentItems } from "../../src/db/schema/course-content";
import { __setAiProviderForTesting } from "../../src/ai/provider/invoke-ai";
import { ScriptedProvider, NotConfiguredProvider, usage } from "../helpers/scripted-ai-provider";
import "../../src/ai/tools";

/**
 * AI Course Editing Phase 1 — Phase 18 "multi-turn editing scenarios A-E," exercised through the
 * real `POST /ai/conversations/:id/messages` route with a `ScriptedProvider` (same convention as
 * `ai-foundation-structured-context.test.ts`), proving each scenario end-to-end rather than only at
 * the `invokeTool`/`confirmToolExecution` level `ai-foundation-course-editing.test.ts` covers.
 */

async function createTestCourse(tenantId: string, userId: string, server: Awaited<ReturnType<typeof buildTestServer>>, overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: "/tenant/courses",
    headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
    payload: { title: `Test Course ${randomUUID().slice(0, 8)}`, category: "Multi-turn Editing Tests", deliveryMode: "self_paced", duration: { value: 1, unit: "hours" }, ...overrides },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}

async function createTestModule(tenantId: string, userId: string, courseId: string, title: string, server: Awaited<ReturnType<typeof buildTestServer>>): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: `/tenant/courses/${courseId}/modules`,
    headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
    payload: { title },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}

async function createTestLesson(tenantId: string, userId: string, moduleId: string, title: string, server: Awaited<ReturnType<typeof buildTestServer>>): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: `/tenant/modules/${moduleId}/content-items`,
    headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
    payload: { type: "article", title, payload: { body: "..." } },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}

function confirmViaHttp(server: Awaited<ReturnType<typeof buildTestServer>>, tenantId: string, userId: string, executionId: string) {
  return server.inject({
    method: "POST",
    url: `/ai/tool-executions/${executionId}/confirm`,
    headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
  });
}

function rejectViaHttp(server: Awaited<ReturnType<typeof buildTestServer>>, tenantId: string, userId: string, executionId: string) {
  return server.inject({
    method: "POST",
    url: `/ai/tool-executions/${executionId}/reject`,
    headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
  });
}

function readCourse(tenantId: string, courseId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(courses).where(eq(courses.id, courseId)));
}

function readModule(tenantId: string, moduleId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(courseModules).where(eq(courseModules.id, moduleId)));
}

function readLesson(tenantId: string, lessonId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.id, lessonId)));
}

describe("AI Course Editing — multi-turn scenarios (Phase 18)", () => {
  afterEach(() => {
    __setAiProviderForTesting(new NotConfiguredProvider());
  });
  afterAll(async () => {
    await closeTestPool();
  });

  // Note on turn structure (matches `ai-foundation-structured-context.test.ts`'s established
  // pattern, confirmed against `ai/routes.ts`'s actual loop): each HTTP turn runs the model AT MOST
  // twice — once to decide on a tool call, and, only if that tool was non-mutating (so it already
  // executed), once more purely to phrase a natural-language summary of the result (that follow-up
  // call's own `toolCalls` are discarded — never chained into a second action within the same turn).
  // So discovering a resource (a read tool) and then acting on it (a mutating tool) always takes at
  // least two separate user turns/HTTP requests, never one — this is what actually proves identity
  // is carried through `reconstructHistory`'s structured context rather than handed to the model in
  // the same breath it was discovered in.

  it("Scenario A — course title update: discover the course by name on turn 1, propose+confirm update_course on turn 2", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server, { title: "Cybersecurity 101" });
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([
          // Turn 1: discover the course (read tool, executes immediately) + a text follow-up.
          () => ({ content: null, toolCalls: [{ id: "c1", name: "list_courses", arguments: {} }], stopReason: "tool_use", usage: usage() }),
          () => ({ content: "Found \"Cybersecurity 101\".", toolCalls: [], stopReason: "end_turn", usage: usage() }),
          // Turn 2: the real id must come from turn 1's STRUCTURED result, not this test handing it over.
          (input) => {
            const toolResult = input.messages.find((m) => m.role === "tool");
            const parsed = JSON.parse(toolResult!.content) as { courses: { id: string; title: string }[] };
            const found = parsed.courses.find((c) => c.title === "Cybersecurity 101");
            return { content: null, toolCalls: [{ id: "c2", name: "update_course", arguments: { courseId: found!.id, title: "Cybersecurity Fundamentals" } }], stopReason: "tool_use", usage: usage() };
          },
        ]),
      );

      const turn1 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "What courses do we have?" } });
      expect(turn1.statusCode).toBe(200);
      expect(turn1.json().data.toolExecution.toolName).toBe("list_courses");

      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Rename the Cybersecurity 101 course to Cybersecurity Fundamentals." } });
      expect(turn2.statusCode).toBe(200);
      const execution = turn2.json().data.toolExecution;
      expect(execution.toolName).toBe("update_course");
      expect(execution.input.courseId).toBe(courseId);
      expect(execution.status).toBe("pending_confirmation");

      const confirmRes = await confirmViaHttp(server, tenantId, userId, execution.id);
      expect(confirmRes.statusCode).toBe(200);
      const [row] = await readCourse(tenantId, courseId);
      expect(row.title).toBe("Cybersecurity Fundamentals");
    } finally {
      await server.close();
    }
  });

  it("Scenario B — module rename: list_course_modules discovers the module id on turn 1, update_course_module uses it on turn 2", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, "Threat Recognition", server);
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({ content: null, toolCalls: [{ id: "c1", name: "list_course_modules", arguments: { courseId } }], stopReason: "tool_use", usage: usage() }),
          () => ({ content: "This course has one module: \"Threat Recognition\".", toolCalls: [], stopReason: "end_turn", usage: usage() }),
          (input) => {
            const toolResult = input.messages.find((m) => m.role === "tool");
            const found = (JSON.parse(toolResult!.content) as { id: string; title: string }[]).find((m) => m.title === "Threat Recognition");
            return { content: null, toolCalls: [{ id: "c2", name: "update_course_module", arguments: { moduleId: found!.id, title: "Recognizing Threats" } }], stopReason: "tool_use", usage: usage() };
          },
        ]),
      );

      const turn1 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "What modules does this course have?" } });
      expect(turn1.json().data.toolExecution.toolName).toBe("list_course_modules");

      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Rename the Threat Recognition module to Recognizing Threats." } });
      const execution = turn2.json().data.toolExecution;
      expect(execution.toolName).toBe("update_course_module");
      expect(execution.input.moduleId).toBe(moduleId);

      await confirmViaHttp(server, tenantId, userId, execution.id);
      const [row] = await readModule(tenantId, moduleId);
      expect(row.title).toBe("Recognizing Threats");
    } finally {
      await server.close();
    }
  });

  it("Scenario C — 'the second lesson in that module': list_course_modules then list_course_lessons resolves it by position, not a guess", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, "Phishing Module", server);
      const firstLessonId = await createTestLesson(tenantId, userId, moduleId, "Intro to Phishing", server);
      const secondLessonId = await createTestLesson(tenantId, userId, moduleId, "Spotting Fake URLs", server);
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([
          // Turn 1: find the module.
          () => ({ content: null, toolCalls: [{ id: "c1", name: "list_course_modules", arguments: { courseId } }], stopReason: "tool_use", usage: usage() }),
          () => ({ content: "Found the Phishing Module.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
          // Turn 2: list its lessons, using the real module id from turn 1's structured result.
          (input) => {
            const toolResult = input.messages.find((m) => m.role === "tool");
            const found = (JSON.parse(toolResult!.content) as { id: string; title: string }[]).find((m) => m.title === "Phishing Module");
            return { content: null, toolCalls: [{ id: "c2", name: "list_course_lessons", arguments: { courseId, moduleId: found!.id } }], stopReason: "tool_use", usage: usage() };
          },
          () => ({ content: "It has two lessons.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
          // Turn 3: "the second lesson" resolved by position from turn 2's structured result.
          (input) => {
            const toolResults = input.messages.filter((m) => m.role === "tool");
            // Module summaries also carry a `position` field, so key off `type` (only lessons have
            // one) to avoid matching the module list instead of the lesson list.
            const lessonsResult = toolResults.map((m) => { try { return JSON.parse(m.content); } catch { return null; } }).find((v) => Array.isArray(v) && v[0]?.type !== undefined);
            const lessons = lessonsResult as { id: string; title: string; position: number }[];
            const second = [...lessons].sort((a, b) => a.position - b.position)[1];
            return { content: null, toolCalls: [{ id: "c3", name: "update_course_lesson", arguments: { lessonId: second.id, title: "Recognizing Fake URLs" } }], stopReason: "tool_use", usage: usage() };
          },
        ]),
      );

      const turn1 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Look at the Phishing Module." } });
      expect(turn1.json().data.toolExecution.toolName).toBe("list_course_modules");

      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "List its lessons for me." } });
      expect(turn2.json().data.toolExecution.toolName).toBe("list_course_lessons");

      const turn3 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Rename the second lesson in that module to 'Recognizing Fake URLs'." } });
      const execution = turn3.json().data.toolExecution;
      expect(execution.toolName).toBe("update_course_lesson");
      expect(execution.input.lessonId).toBe(secondLessonId);
      expect(execution.input.lessonId).not.toBe(firstLessonId);

      await confirmViaHttp(server, tenantId, userId, execution.id);
      const [row] = await readLesson(tenantId, secondLessonId);
      expect(row.title).toBe("Recognizing Fake URLs");
    } finally {
      await server.close();
    }
  });

  it("Scenario D — multiple fields updated in a single proposal", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server, { title: "Old Title", provider: "Old Provider" });
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({
            content: null,
            toolCalls: [{ id: "c1", name: "update_course", arguments: { courseId, title: "New Title", provider: "New Provider", cost: 199.99 } }],
            stopReason: "tool_use",
            usage: usage(),
          }),
        ]),
      );

      const turn1 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Change the title to 'New Title', the provider to 'New Provider', and the cost to 199.99." } });
      const execution = turn1.json().data.toolExecution;
      expect(execution.input).toMatchObject({ title: "New Title", provider: "New Provider", cost: 199.99 });

      await confirmViaHttp(server, tenantId, userId, execution.id);
      const [row] = await readCourse(tenantId, courseId);
      expect(row.title).toBe("New Title");
      expect(row.provider).toBe("New Provider");
      expect(row.cost).toBe(199.99);
    } finally {
      await server.close();
    }
  });

  it("Scenario E — a follow-up correction before confirmation creates a second, independent proposal rather than mutating the first", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, "Original Module Title", server);
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({ content: null, toolCalls: [{ id: "c1", name: "update_course_module", arguments: { moduleId, title: "Y" } }], stopReason: "tool_use", usage: usage() }),
          () => ({ content: null, toolCalls: [{ id: "c2", name: "update_course_module", arguments: { moduleId, title: "Z" } }], stopReason: "tool_use", usage: usage() }),
        ]),
      );

      const turn1 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Rename the module to Y." } });
      const firstExecution = turn1.json().data.toolExecution;
      expect(firstExecution.status).toBe("pending_confirmation");

      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Actually, call it Z instead." } });
      const secondExecution = turn2.json().data.toolExecution;
      expect(secondExecution.status).toBe("pending_confirmation");
      expect(secondExecution.id).not.toBe(firstExecution.id); // a distinct proposal, not an edit of the first
      expect(secondExecution.input.title).toBe("Z");

      // Reject the stale first proposal, confirm only the corrected one.
      const rejectRes = await rejectViaHttp(server, tenantId, userId, firstExecution.id);
      expect(rejectRes.statusCode).toBe(200);
      const confirmRes = await confirmViaHttp(server, tenantId, userId, secondExecution.id);
      expect(confirmRes.statusCode).toBe(200);

      const [row] = await readModule(tenantId, moduleId);
      expect(row.title).toBe("Z"); // only the corrected proposal ever applied

      // The rejected first proposal cannot later be confirmed either.
      const lateConfirm = await confirmViaHttp(server, tenantId, userId, firstExecution.id);
      expect(lateConfirm.statusCode).not.toBe(200);
    } finally {
      await server.close();
    }
  });
});
