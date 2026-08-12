import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole, seedSuperAdminSession } from "../helpers/fixtures";
import { withTenantDb, closeTestPool } from "../helpers/pg";
import type { Db } from "../../src/db/client";
import { contentItems, courseModules } from "../../src/db/schema/course-content";
import { __setAiProviderForTesting } from "../../src/ai/provider/invoke-ai";
import { ScriptedProvider, NotConfiguredProvider, usage } from "../helpers/scripted-ai-provider";
import { listTools, describeToolForProvider } from "../../src/ai/tool-registry";
import "../../src/ai/tools";

/**
 * AI Foundation — Tool Selection & Scope Guardrails. Root cause of the bug this phase fixes (real
 * live test, prior phase): the model selected `update_form_field` for a course-lesson title change
 * because (a) no tool description ruled that out, (b) the system prompt had no instruction against
 * substituting an unrelated tool when none matches, and (c) every tool — 11 of them, spanning two
 * domains — is exposed on every single turn with nothing distinguishing which domain each belongs
 * to. Fixed via `[domain → resource.operation]` tags (`ai/tool-registry.ts`'s
 * `describeToolForProvider`, sourced from new required `domain`/`resource`/`operation` fields on
 * `AiToolDefinition`) plus a new SYSTEM_PROMPT paragraph — not a new heuristic layer.
 *
 * IMPORTANT — what these tests can and cannot prove: a `ScriptedProvider` lets us assert precisely
 * on application-side plumbing (an unsupported request that produces no tool call must never reach a
 * proposal; existing tools must still work; the tag is actually present in what's sent to a
 * provider). It CANNOT prove a real model reliably chooses not to call a tool — only live testing
 * against the real configured provider can (see this phase's final report for that evidence). Do not
 * mistake "these tests pass" for "the model will always behave" — they prove the safety net is
 * correctly built, not that the net is never needed.
 */

async function createTestCourse(tenantId: string, userId: string, server: Awaited<ReturnType<typeof buildTestServer>>): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: "/tenant/courses",
    headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
    payload: { title: `Test Course ${randomUUID().slice(0, 8)}`, category: "Tool Selection Tests", deliveryMode: "self_paced", duration: { value: 1, unit: "hours" } },
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

async function createTestFormField(adminHeaders: Record<string, string>, server: Awaited<ReturnType<typeof buildTestServer>>): Promise<{ formKey: string; fieldId: string }> {
  const formKey = `test_toolsel_${randomUUID().slice(0, 8)}`;
  const formRes = await server.inject({
    method: "POST",
    url: "/platform/forms",
    headers: adminHeaders,
    payload: { name: "Tool Selection Test Form", key: formKey, description: "Seeded for tool-selection tests." },
  });
  expect(formRes.statusCode).toBe(201);
  return { formKey, fieldId: "" };
}

describe("AI Foundation — every registered tool carries the [domain → resource.operation] tag", () => {
  it("no tool is missing domain/resource/operation, and the composed description actually contains the tag", () => {
    const tools = listTools().filter((t) => t.scope === "tenant");
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.domain, `${tool.name} is missing domain`).toBeTruthy();
      expect(tool.resource, `${tool.name} is missing resource`).toBeTruthy();
      expect(tool.operation, `${tool.name} is missing operation`).toBeTruthy();
      expect(describeToolForProvider(tool)).toBe(`[${tool.domain} → ${tool.resource}.${tool.operation}] ${tool.description}`);
    }
  });

  it("update_form_field and create_course_lesson are tagged with different, correct domains — the exact distinction the model needs", () => {
    const updateFormField = listTools().find((t) => t.name === "update_form_field")!;
    const createCourseLesson = listTools().find((t) => t.name === "create_course_lesson")!;
    expect(updateFormField.domain).toBe("forms");
    expect(updateFormField.resource).toBe("field");
    expect(createCourseLesson.domain).toBe("courses");
    expect(createCourseLesson.resource).toBe("lesson");
    expect(describeToolForProvider(updateFormField)).toMatch(/^\[forms → field\.update\]/);
    expect(describeToolForProvider(createCourseLesson)).toMatch(/^\[courses → lesson\.create\]/);
  });
});

describe("AI Foundation — unsupported operations never reach a proposal", () => {
  afterEach(() => {
    __setAiProviderForTesting(new NotConfiguredProvider());
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("Test 1+2: when the model correctly declines an unsupported operation (no tool call), no proposal or execution is ever created — plain text only", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, "Recognizing Threats", server);
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({
            content: "I can help create and manage course content, but editing an existing lesson's title isn't available through the assistant yet — you can rename it directly in the course editor.",
            toolCalls: [],
            stopReason: "end_turn",
            usage: usage(),
          }),
        ]),
      );

      const res = await server.inject({
        method: "POST",
        url: `/ai/conversations/${conversationId}/messages`,
        headers,
        payload: { content: "Change the title of the lesson in the Recognizing Threats module.", context: { courseId } },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json().data;
      expect(body.toolExecution).toBeNull(); // no proposal, no execution row at all
      expect(body.message.content.length).toBeGreaterThan(0); // a real explanation, not a blank reply
      expect(body.message.content.toLowerCase()).toMatch(/not|isn't|unavailable|can't|cannot/);

      // Nothing in the DB changed as a result of this turn.
      const modules = await withTenantDb(tenantId, (db: Db) => db.select().from(courseModules).where(eq(courseModules.id, moduleId)));
      expect(modules).toHaveLength(1);
      expect(modules[0].title).toBe("Recognizing Threats"); // unchanged
    } finally {
      await server.close();
    }
  });

  it("Test 5: an ambiguous reference with no reliable resolution produces clarification, not a tool call", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      await createTestModule(tenantId, userId, courseId, "Security Basics", server);
      await createTestModule(tenantId, userId, courseId, "Security Basics — Advanced", server);
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({ content: null, toolCalls: [{ id: "c1", name: "list_course_modules", arguments: { courseId } }], stopReason: "tool_use", usage: usage() }),
          () => ({
            content: 'There are two modules that could match: "Security Basics" and "Security Basics — Advanced." Which one did you mean?',
            toolCalls: [],
            stopReason: "end_turn",
            usage: usage(),
          }),
        ]),
      );

      const res = await server.inject({
        method: "POST",
        url: `/ai/conversations/${conversationId}/messages`,
        headers,
        payload: { content: "Add a lesson to the security module.", context: { courseId } },
      });

      expect(res.statusCode).toBe(200);
      // The one tool call that DID happen was a read (discovery), never a mutation — and the turn
      // ends with a question, not a proposal.
      expect(res.json().data.toolExecution.toolName).toBe("list_course_modules");
      expect(res.json().data.toolExecution.mutating).toBe(false);
      const items = await withTenantDb(tenantId, (db: Db) => db.select().from(contentItems));
      expect(items).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("Test 7: after successful multi-turn identity tracking, the model correctly declines an unsupported edit instead of repurposing an unrelated tool", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage", "forms.manage.tenant"]);

    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, "Recognizing Threats", server);
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      // Turn 1: create the lesson (real, successful, confirmed flow).
      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({
            content: null,
            toolCalls: [{ id: "c1", name: "create_course_lesson", arguments: { courseId, moduleId, type: "article", title: "Phishing basics", payload: { body: "..." } } }],
            stopReason: "tool_use",
            usage: usage(),
          }),
        ]),
      );
      const turn1 = await server.inject({
        method: "POST",
        url: `/ai/conversations/${conversationId}/messages`,
        headers,
        payload: { content: "Add a lesson about phishing basics to the Recognizing Threats module.", context: { courseId } },
      });
      const lessonExecutionId = turn1.json().data.toolExecution.id as string;
      const confirmRes = await server.inject({ method: "POST", url: `/ai/tool-executions/${lessonExecutionId}/confirm`, headers });
      const lessonId = confirmRes.json().data.output.id as string;

      // Turn 2: "now change its title" — the model KNOWS the lesson's real id (it's right there in
      // structured history from turn 1, per the Structured Tool Context phase) but there is still no
      // update_course_lesson tool. Correct behavior: decline in text, not repurpose Forms.
      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({
            content: "I can see the lesson I just created, but I don't have a way to edit an existing lesson's title yet — that's not supported through the assistant at the moment.",
            toolCalls: [],
            stopReason: "end_turn",
            usage: usage(),
          }),
        ]),
      );
      const turn2 = await server.inject({
        method: "POST",
        url: `/ai/conversations/${conversationId}/messages`,
        headers,
        payload: { content: "Now change its title to 'Introduction to Phishing'.", context: { courseId } },
      });

      expect(turn2.statusCode).toBe(200);
      expect(turn2.json().data.toolExecution).toBeNull(); // no update_form_field, no proposal, nothing

      const items = await withTenantDb(tenantId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.id, lessonId)));
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe("Phishing basics"); // unchanged — never silently retitled
    } finally {
      await server.close();
    }
  });
});

describe("AI Foundation — the new guardrails do not break legitimate same-domain use", () => {
  afterEach(() => {
    __setAiProviderForTesting(new NotConfiguredProvider());
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("Test 3: a genuine Forms field update still works end-to-end (propose → confirm → executed)", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["forms.manage.tenant"]);
    const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

    const server = await buildTestServer();
    try {
      const { formKey } = await createTestFormField({ cookie: cookieHeader }, server);
      const createFieldRes = await server.inject({
        method: "POST",
        url: `/tenant/forms/${formKey}/fields`,
        headers,
        payload: { label: "Employee ID", fieldType: "text" },
      });
      expect(createFieldRes.statusCode).toBe(201);
      const fieldId = createFieldRes.json().data.id as string;

      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;
      __setAiProviderForTesting(
        new ScriptedProvider([() => ({ content: null, toolCalls: [{ id: "c1", name: "update_form_field", arguments: { formKey, fieldId, label: "Employee Number" } }], stopReason: "tool_use", usage: usage() })]),
      );

      const res = await server.inject({
        method: "POST",
        url: `/ai/conversations/${conversationId}/messages`,
        headers,
        payload: { content: "Change the label of the Employee ID field to Employee Number." },
      });
      expect(res.json().data.toolExecution.toolName).toBe("update_form_field");
      const confirmRes = await server.inject({ method: "POST", url: `/ai/tool-executions/${res.json().data.toolExecution.id}/confirm`, headers });
      expect(confirmRes.json().data.status).toBe("executed");
      expect(confirmRes.json().data.output.label).toBe("Employee Number");
    } finally {
      await server.close();
    }
  });

  it("Test 4: a genuine Course lesson creation still works end-to-end (propose → confirm → executed)", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, "Recognizing Threats", server);
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({
            content: null,
            toolCalls: [{ id: "c1", name: "create_course_lesson", arguments: { courseId, moduleId, type: "article", title: "Recognizing phishing emails", payload: { body: "..." } } }],
            stopReason: "tool_use",
            usage: usage(),
          }),
        ]),
      );

      const res = await server.inject({
        method: "POST",
        url: `/ai/conversations/${conversationId}/messages`,
        headers,
        payload: { content: "Add a lesson about recognizing phishing emails to the Recognizing Threats module.", context: { courseId } },
      });
      expect(res.json().data.toolExecution.toolName).toBe("create_course_lesson");
      const confirmRes = await server.inject({ method: "POST", url: `/ai/tool-executions/${res.json().data.toolExecution.id}/confirm`, headers });
      expect(confirmRes.json().data.status).toBe("executed");
      expect(confirmRes.json().data.output.moduleId).toBe(moduleId);
    } finally {
      await server.close();
    }
  });
});

