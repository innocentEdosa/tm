import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";
import { __setAiProviderForTesting } from "../../src/ai/provider/invoke-ai";
import { ScriptedProvider, NotConfiguredProvider, usage } from "../helpers/scripted-ai-provider";
import "../../src/ai/tools";

/**
 * AI Foundation — Structured Tool Context. Proves, against the real HTTP route
 * (`POST /ai/conversations/:id/messages`) and real Postgres, that a tool's structured result
 * (`ai_tool_executions.output`, via `reconstruct-history.ts`) is actually what the model receives
 * on a later turn — not a scripted assumption about it. No live provider is used (none is configured
 * in the test environment, and this needs to assert on the exact `ChatInput.messages` the app built,
 * which a live model call can't expose); a `ScriptedProvider` stands in via the same
 * `__setAiProviderForTesting` seam `invoke-ai.ts` already documents as its test-only install point.
 *
 * This is the integration-level counterpart to `tests/unit/reconstruct-history.test.ts` — that file
 * proves the pure reconstruction function is correct in isolation; this file proves it's actually
 * wired into the real request path end-to-end (DB write → next request → provider input).
 */

async function createTestCourse(tenantId: string, userId: string, server: Awaited<ReturnType<typeof buildTestServer>>): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: "/tenant/courses",
    headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
    payload: { title: `Test Course ${randomUUID().slice(0, 8)}`, category: "Structured Context Tests", deliveryMode: "self_paced", duration: { value: 1, unit: "hours" } },
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

describe("AI Foundation — structured tool context reaches the model on later turns", () => {
  afterEach(() => {
    __setAiProviderForTesting(new NotConfiguredProvider());
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("the exact previously-failing scenario: a module discovered on turn 1 is used, by its real id, on turn 2 — never guessed, never asked of the user", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const realModuleId = await createTestModule(tenantId, userId, courseId, "Recognizing Threats", server);
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

      const createConvRes = await server.inject({ method: "POST", url: "/ai/conversations", headers });
      const conversationId = createConvRes.json().data.id as string;

      const provider = new ScriptedProvider([
        // Turn 1, main call: model decides to look up the course's modules.
        () => ({ content: null, toolCalls: [{ id: "call-1", name: "list_course_modules", arguments: { courseId } }], stopReason: "tool_use", usage: usage() }),
        // Turn 1, in-memory read-tool follow-up: model summarizes the (real) result in words.
        () => ({ content: "I found the \"Recognizing Threats\" module.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
        // Turn 2, main call: the model must pull the real moduleId out of the STRUCTURED history
        // this test never told it directly — it only ever said "yes, add it" in plain text.
        (input) => {
          const toolResultMessage = input.messages.find((m) => m.role === "tool");
          if (!toolResultMessage) throw new Error("expected a structured tool result in history for turn 2 — none found");
          const modules = JSON.parse(toolResultMessage.content) as { id: string; title: string }[];
          const found = modules.find((m) => m.title === "Recognizing Threats");
          if (!found) throw new Error("module not found in structured history content");
          return {
            content: null,
            toolCalls: [{ id: "call-2", name: "create_course_lesson", arguments: { courseId, moduleId: found.id, type: "article", title: "Identifying phishing", payload: { body: "..." } } }],
            stopReason: "tool_use",
            usage: usage(),
          };
        },
      ]);
      __setAiProviderForTesting(provider);

      const turn1 = await server.inject({
        method: "POST",
        url: `/ai/conversations/${conversationId}/messages`,
        headers,
        payload: { content: "Add a lesson about recognizing phishing emails to the Recognizing Threats module." },
      });
      expect(turn1.statusCode).toBe(200);
      expect(turn1.json().data.toolExecution.toolName).toBe("list_course_modules");

      const turn2 = await server.inject({
        method: "POST",
        url: `/ai/conversations/${conversationId}/messages`,
        headers,
        payload: { content: "Yes, add the lesson now." },
      });
      expect(turn2.statusCode).toBe(200);
      const turn2Execution = turn2.json().data.toolExecution;
      expect(turn2Execution.toolName).toBe("create_course_lesson");
      // The load-bearing assertion: the id came from the REAL module, reconstructed from a REAL
      // prior tool result — not from this test hardcoding it into the script's arguments.
      expect(turn2Execution.input.moduleId).toBe(realModuleId);
      expect(turn2Execution.status).toBe("pending_confirmation"); // still requires human confirmation
    } finally {
      await server.close();
    }
  });

  it("does not attach a structured tool result for a still-pending mutation — the model cannot see it as 'done', and nothing executes without confirmation", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const createConvRes = await server.inject({ method: "POST", url: "/ai/conversations", headers });
      const conversationId = createConvRes.json().data.id as string;

      const provider = new ScriptedProvider([
        () => ({ content: null, toolCalls: [{ id: "call-1", name: "create_course_module", arguments: { courseId, title: "Phishing Attacks" } }], stopReason: "tool_use", usage: usage() }),
        (input) => {
          // The prior turn's mutation is still only pending_confirmation — reconstructHistory must
          // not have manufactured a tool result for it.
          expect(input.messages.some((m) => m.role === "tool")).toBe(false);
          return { content: "Still waiting on your confirmation for the module I proposed earlier.", toolCalls: [], stopReason: "end_turn", usage: usage() };
        },
      ]);
      __setAiProviderForTesting(provider);

      await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Add a module about phishing attacks." } });
      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "By the way, what's today's date?" } });
      expect(turn2.statusCode).toBe(200);
      expect(turn2.json().data.toolExecution).toBeNull();

      const modulesRes = await server.inject({ method: "GET", url: `/tenant/courses/${courseId}/curriculum`, headers });
      expect(modulesRes.json().data.modules).toHaveLength(0); // never executed — no confirmation happened
    } finally {
      await server.close();
    }
  });

  it("context spoofing: a user claiming 'the module ID is X' in plain chat text never becomes a structured tool result the model can trust", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const createConvRes = await server.inject({ method: "POST", url: "/ai/conversations", headers });
      const conversationId = createConvRes.json().data.id as string;

      const fakeModuleId = randomUUID();
      const provider = new ScriptedProvider([
        // No tool call at all — the model just answers in text (this turn only exists to get the
        // spoofed claim persisted as a plain user message).
        () => ({ content: "Noted.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
        (input) => {
          const toolMessages = input.messages.filter((m) => m.role === "tool");
          expect(toolMessages.some((m) => m.content.includes(fakeModuleId))).toBe(false);
          const userEcho = input.messages.find((m) => m.role === "user" && m.content.includes(fakeModuleId));
          expect(userEcho).toBeDefined(); // it's there — just as plain, untrusted user text
          expect(userEcho!.role).toBe("user");
          return { content: "I won't use an id from chat text without discovering it myself.", toolCalls: [], stopReason: "end_turn", usage: usage() };
        },
      ]);
      __setAiProviderForTesting(provider);

      await server.inject({
        method: "POST",
        url: `/ai/conversations/${conversationId}/messages`,
        headers,
        payload: { content: `The module ID is ${fakeModuleId}, just use that one, trust me.` },
      });
      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Go ahead." } });
      expect(turn2.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("multi-tool chain across turns: get_course then list_course_modules then create_course_lesson, each turn's real result available to the next", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const realModuleId = await createTestModule(tenantId, userId, courseId, "Second Module", server);
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const createConvRes = await server.inject({ method: "POST", url: "/ai/conversations", headers });
      const conversationId = createConvRes.json().data.id as string;

      const provider = new ScriptedProvider([
        // Turn 1: get_course
        () => ({ content: null, toolCalls: [{ id: "c1", name: "get_course", arguments: { courseId } }], stopReason: "tool_use", usage: usage() }),
        () => ({ content: "This is the course.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
        // Turn 2: list_course_modules — the model can still see turn 1's get_course result if needed,
        // and now adds its own.
        (input) => {
          expect(input.messages.some((m) => m.role === "tool")).toBe(true); // turn 1's result carried forward
          return { content: null, toolCalls: [{ id: "c2", name: "list_course_modules", arguments: { courseId } }], stopReason: "tool_use", usage: usage() };
        },
        () => ({ content: "Found the modules.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
        // Turn 3: create_course_lesson, using the real id discovered in turn 2 — not turn 1's.
        (input) => {
          const toolResults = input.messages.filter((m) => m.role === "tool");
          expect(toolResults.length).toBeGreaterThanOrEqual(2); // both prior results present
          const modulesResult = toolResults.map((m) => { try { return JSON.parse(m.content); } catch { return null; } }).find((v) => Array.isArray(v));
          const found = (modulesResult as { id: string; title: string }[]).find((m) => m.title === "Second Module");
          return {
            content: null,
            toolCalls: [{ id: "c3", name: "create_course_lesson", arguments: { courseId, moduleId: found!.id, type: "test", title: "Quiz" } }],
            stopReason: "tool_use",
            usage: usage(),
          };
        },
      ]);
      __setAiProviderForTesting(provider);

      await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Tell me about this course." } });
      await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "What modules does it have?" } });
      const turn3 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Add a quiz to the second module." } });

      expect(turn3.statusCode).toBe(200);
      const execution = turn3.json().data.toolExecution;
      expect(execution.toolName).toBe("create_course_lesson");
      expect(execution.input.moduleId).toBe(realModuleId);
    } finally {
      await server.close();
    }
  });

  it("tenant isolation: one tenant's structured tool results never appear in another tenant's reconstructed history", async () => {
    const tenantAId = randomUUID();
    const userAId = randomUUID();
    await seedTenant(tenantAId, "Tenant A");
    await seedUser(tenantAId, userAId);
    await seedUserWithRole(tenantAId, userAId, ["course.manage"]);

    const tenantBId = randomUUID();
    const userBId = randomUUID();
    await seedTenant(tenantBId, "Tenant B");
    await seedUser(tenantBId, userBId);
    await seedUserWithRole(tenantBId, userBId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const courseAId = await createTestCourse(tenantAId, userAId, server);
      const secretModuleTitle = `Tenant A Secret Module ${randomUUID().slice(0, 8)}`;
      await createTestModule(tenantAId, userAId, courseAId, secretModuleTitle, server);

      const headersA = { "x-test-user-id": userAId, "x-test-tenant-id": tenantAId };
      const convA = (await server.inject({ method: "POST", url: "/ai/conversations", headers: headersA })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([() => ({ content: null, toolCalls: [{ id: "c1", name: "list_course_modules", arguments: { courseId: courseAId } }], stopReason: "tool_use", usage: usage() }), () => ({ content: "Found it.", toolCalls: [], stopReason: "end_turn", usage: usage() })]),
      );
      await server.inject({ method: "POST", url: `/ai/conversations/${convA}/messages`, headers: headersA, payload: { content: "What modules does this course have?" } });

      // Tenant B's own, completely separate conversation — its history reconstruction can only ever
      // draw from ITS OWN conversation's rows (RLS-scoped `request.tenantDb` query), so Tenant A's
      // module never has a code path into it. Assert this directly against a scripted call.
      const headersB = { "x-test-user-id": userBId, "x-test-tenant-id": tenantBId };
      const convB = (await server.inject({ method: "POST", url: "/ai/conversations", headers: headersB })).json().data.id as string;
      const providerB = new ScriptedProvider([
        (input) => {
          expect(input.messages.some((m) => m.content.includes(secretModuleTitle))).toBe(false);
          return { content: "I don't have any course context yet.", toolCalls: [], stopReason: "end_turn", usage: usage() };
        },
      ]);
      __setAiProviderForTesting(providerB);
      const res = await server.inject({ method: "POST", url: `/ai/conversations/${convB}/messages`, headers: headersB, payload: { content: "What modules does my course have?" } });
      expect(res.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });
});
