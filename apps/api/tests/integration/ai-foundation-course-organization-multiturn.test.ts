import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { withTenantDb, closeTestPool } from "../helpers/pg";
import type { Db } from "../../src/db/client";
import { courseModules, contentItems } from "../../src/db/schema/course-content";
import { __setAiProviderForTesting } from "../../src/ai/provider/invoke-ai";
import { ScriptedProvider, NotConfiguredProvider, usage } from "../helpers/scripted-ai-provider";
import "../../src/ai/tools";

/**
 * Course Organization AI Phase 1 — Phase 17's multi-turn scenarios A-F, driven through the real
 * `POST /ai/conversations/:id/messages` route with a `ScriptedProvider` (same convention as
 * `ai-foundation-course-editing-multiturn.test.ts`). Turn structure follows the same rule confirmed
 * against `ai/routes.ts`'s actual loop: a non-mutating tool call costs TWO provider calls in one HTTP
 * turn (the call itself, then a text-only follow-up whose own `toolCalls` are discarded) — chaining a
 * second real tool call always needs a new user turn. Scenarios D/E/F prove the ARCHITECTURE behaves
 * correctly when the model responds a given way (declines, asks for clarification) — they do not by
 * themselves prove a real model reliably chooses that way; that's what live OpenAI testing (this
 * phase's own live-validation task) is for.
 */

async function createTestCourse(tenantId: string, userId: string, server: Awaited<ReturnType<typeof buildTestServer>>, overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: "/tenant/courses",
    headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
    payload: { title: `Test Course ${randomUUID().slice(0, 8)}`, category: "Organization Multi-turn Tests", deliveryMode: "self_paced", duration: { value: 1, unit: "hours" }, ...overrides },
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
  return server.inject({ method: "POST", url: `/ai/tool-executions/${executionId}/confirm`, headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId } });
}

function rejectViaHttp(server: Awaited<ReturnType<typeof buildTestServer>>, tenantId: string, userId: string, executionId: string) {
  return server.inject({ method: "POST", url: `/ai/tool-executions/${executionId}/reject`, headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId } });
}

function readModules(tenantId: string, courseId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(courseModules).where(eq(courseModules.courseId, courseId)).orderBy(courseModules.position));
}

function readModule(tenantId: string, moduleId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(courseModules).where(eq(courseModules.id, moduleId)));
}

function readLessons(tenantId: string, moduleId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.moduleId, moduleId)).orderBy(contentItems.position));
}

describe("Course Organization AI — multi-turn scenarios (Phase 17)", () => {
  afterEach(() => {
    __setAiProviderForTesting(new NotConfiguredProvider());
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("Scenario A — module reorder: list_course_modules discovers order/ids on turn 1, reorder_course_modules moves the second module to the top on turn 2", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const first = await createTestModule(tenantId, userId, courseId, "Introduction", server);
      const second = await createTestModule(tenantId, userId, courseId, "Security Awareness", server);
      const third = await createTestModule(tenantId, userId, courseId, "Compliance", server);
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({ content: null, toolCalls: [{ id: "c1", name: "list_course_modules", arguments: { courseId } }], stopReason: "tool_use", usage: usage() }),
          () => ({ content: "This course has three modules: Introduction, Security Awareness, and Compliance.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
          (input) => {
            const toolResult = input.messages.find((m) => m.role === "tool");
            const modules = JSON.parse(toolResult!.content) as { id: string; title: string }[];
            const bySecond = modules.find((m) => m.title === "Security Awareness")!;
            const rest = modules.filter((m) => m.id !== bySecond.id);
            return {
              content: null,
              toolCalls: [{ id: "c2", name: "reorder_course_modules", arguments: { courseId, modules: [{ id: bySecond.id, title: bySecond.title }, ...rest.map((m) => ({ id: m.id, title: m.title }))] } }],
              stopReason: "tool_use",
              usage: usage(),
            };
          },
        ]),
      );

      const turn1 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "What modules are in this course?" } });
      expect(turn1.json().data.toolExecution.toolName).toBe("list_course_modules");

      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Move the second module to the top." } });
      const execution = turn2.json().data.toolExecution;
      expect(execution.toolName).toBe("reorder_course_modules");
      expect(execution.input.modules.map((m: { id: string }) => m.id)).toEqual([second, first, third]);

      await confirmViaHttp(server, tenantId, userId, execution.id);
      const modules = await readModules(tenantId, courseId);
      expect(modules.map((m) => m.id)).toEqual([second, first, third]);
    } finally {
      await server.close();
    }
  });

  it("Scenario B — lesson reorder: find the module, list its lessons, then move the last lesson to first", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, "Password Hygiene", server);
      const l1 = await createTestLesson(tenantId, userId, moduleId, "Choosing Strong Passwords", server);
      const l2 = await createTestLesson(tenantId, userId, moduleId, "Password Managers", server);
      const l3 = await createTestLesson(tenantId, userId, moduleId, "Multi-Factor Authentication", server);
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({ content: null, toolCalls: [{ id: "c1", name: "list_course_modules", arguments: { courseId } }], stopReason: "tool_use", usage: usage() }),
          () => ({ content: "Found the Password Hygiene module.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
          (input) => {
            const toolResult = input.messages.find((m) => m.role === "tool");
            const modules = JSON.parse(toolResult!.content) as { id: string; title: string }[];
            const found = modules.find((m) => m.title === "Password Hygiene")!;
            return { content: null, toolCalls: [{ id: "c2", name: "list_course_lessons", arguments: { courseId, moduleId: found.id } }], stopReason: "tool_use", usage: usage() };
          },
          () => ({ content: "It has three lessons.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
          (input) => {
            const toolResults = input.messages.filter((m) => m.role === "tool");
            const lessonsResult = toolResults.map((m) => { try { return JSON.parse(m.content); } catch { return null; } }).find((v) => Array.isArray(v) && v[0]?.type !== undefined);
            const lessons = (lessonsResult as { id: string; title: string; position: number }[]).slice().sort((a, b) => a.position - b.position);
            const last = lessons[lessons.length - 1];
            const rest = lessons.filter((l) => l.id !== last.id);
            return {
              content: null,
              toolCalls: [{ id: "c3", name: "reorder_course_lessons", arguments: { moduleId, lessons: [{ id: last.id, title: last.title }, ...rest.map((l) => ({ id: l.id, title: l.title }))] } }],
              stopReason: "tool_use",
              usage: usage(),
            };
          },
        ]),
      );

      const turn1 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Which module is Password Hygiene?" } });
      expect(turn1.json().data.toolExecution.toolName).toBe("list_course_modules");

      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "List its lessons." } });
      expect(turn2.json().data.toolExecution.toolName).toBe("list_course_lessons");

      const turn3 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Move the last lesson to the first position." } });
      const execution = turn3.json().data.toolExecution;
      expect(execution.toolName).toBe("reorder_course_lessons");
      expect(execution.input.lessons.map((l: { id: string }) => l.id)).toEqual([l3, l1, l2]);

      await confirmViaHttp(server, tenantId, userId, execution.id);
      const lessons = await readLessons(tenantId, moduleId);
      expect(lessons.map((l) => l.id)).toEqual([l3, l1, l2]);
    } finally {
      await server.close();
    }
  });

  it("Scenario C — archive: reject the first proposal (DB unchanged), then confirm a fresh one", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, "Compliance", server);
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({ content: null, toolCalls: [{ id: "c1", name: "list_course_modules", arguments: { courseId } }], stopReason: "tool_use", usage: usage() }),
          () => ({ content: "Found the Compliance module.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
          () => ({ content: null, toolCalls: [{ id: "c2", name: "archive_course_module", arguments: { moduleId, title: "Compliance" } }], stopReason: "tool_use", usage: usage() }),
          () => ({ content: null, toolCalls: [{ id: "c3", name: "archive_course_module", arguments: { moduleId, title: "Compliance" } }], stopReason: "tool_use", usage: usage() }),
        ]),
      );

      await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "What modules does this course have?" } });
      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Archive the outdated Compliance module." } });
      const firstProposal = turn2.json().data.toolExecution;
      expect(firstProposal.toolName).toBe("archive_course_module");

      const rejectRes = await rejectViaHttp(server, tenantId, userId, firstProposal.id);
      expect(rejectRes.statusCode).toBe(200);
      const [afterReject] = await readModule(tenantId, moduleId);
      expect(afterReject.status).toBe("draft"); // unchanged

      const turn3 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Actually, go ahead and archive it." } });
      const secondProposal = turn3.json().data.toolExecution;
      expect(secondProposal.id).not.toBe(firstProposal.id);

      const confirmRes = await confirmViaHttp(server, tenantId, userId, secondProposal.id);
      expect(confirmRes.statusCode).toBe(200);
      const [afterConfirm] = await readModule(tenantId, moduleId);
      expect(afterConfirm.status).toBe("archived");
    } finally {
      await server.close();
    }
  });

  it("Scenario D — genuine ambiguity: two identically-named modules, the model asking for clarification results in no reorder proposal", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      await createTestModule(tenantId, userId, courseId, "Security", server);
      await createTestModule(tenantId, userId, courseId, "Introduction", server);
      await createTestModule(tenantId, userId, courseId, "Security", server);
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([
          // Turn 1: discover the modules (non-mutating tool call + its own text follow-up — 2 calls).
          () => ({ content: null, toolCalls: [{ id: "c1", name: "list_course_modules", arguments: { courseId } }], stopReason: "tool_use", usage: usage() }),
          () => ({ content: "This course has three modules: two named \"Security\" and one \"Introduction\".", toolCalls: [], stopReason: "end_turn", usage: usage() }),
          // Turn 2: a fresh top-level call — asks for clarification instead of guessing.
          () => ({ content: "There are two modules named \"Security\" — which one do you mean, the first or the second?", toolCalls: [], stopReason: "end_turn", usage: usage() }),
        ]),
      );

      await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "What modules are in this course?" } });
      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Move Security to the top." } });
      expect(turn2.statusCode).toBe(200);
      expect(turn2.json().data.toolExecution).toBeNull(); // no reorder proposal created — the model asked instead of guessing
      expect(turn2.json().data.message.content).toMatch(/which one/i);
    } finally {
      await server.close();
    }
  });

  it("Scenario E — unsupported cross-module lesson move: declining in plain text leaves no reorder proposal", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleA = await createTestModule(tenantId, userId, courseId, "Module A", server);
      const moduleB = await createTestModule(tenantId, userId, courseId, "Module B", server);
      await createTestLesson(tenantId, userId, moduleA, "Some Lesson", server);
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;
      void moduleB;

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({ content: "Moving a lesson to a different module isn't supported yet — I can only reorder lessons within the same module.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
        ]),
      );

      const res = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Move this lesson from Module A to Module B." } });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.toolExecution).toBeNull();
      expect(res.json().data.message.content).toMatch(/support/i);
    } finally {
      await server.close();
    }
  });

  it("Scenario F — cross-domain guardrail: a Forms question under heavy course-organization context still selects the Forms tool, not a course tool", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, "Some Module", server);
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({ content: null, toolCalls: [{ id: "c1", name: "archive_course_module", arguments: { moduleId, title: "Some Module" } }], stopReason: "tool_use", usage: usage() }),
        ]),
      );
      const turn1 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Archive the Some Module module." } });
      expect(turn1.json().data.toolExecution.toolName).toBe("archive_course_module");

      __setAiProviderForTesting(
        new ScriptedProvider([() => ({ content: null, toolCalls: [{ id: "c2", name: "list_form_fields", arguments: { formKey: "member" } }], stopReason: "tool_use", usage: usage() }), () => ({ content: "Here are the member form's fields.", toolCalls: [], stopReason: "end_turn", usage: usage() })]),
      );
      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "What fields does the member form have?" } });
      expect(turn2.json().data.toolExecution.toolName).toBe("list_form_fields"); // not a course tool, despite heavy prior course context
    } finally {
      await server.close();
    }
  });
});
