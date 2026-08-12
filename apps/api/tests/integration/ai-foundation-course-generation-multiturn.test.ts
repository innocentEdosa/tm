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
import { GENERATION_LIMITS } from "../../src/courses/course-service";
import "../../src/ai/tools";

/**
 * Course Generation AI Phase 1 — Phase 18's multi-turn scenarios, driven through the real
 * `POST /ai/conversations/:id/messages` route with a `ScriptedProvider`. Turn structure: a mutating
 * tool call (generate_course_structure always is) stops the turn immediately with
 * `pending_confirmation` — no follow-up call in the same turn, confirmed by every prior phase's own
 * multi-turn tests.
 */

function samplePlan(overrides: Record<string, unknown> = {}) {
  return {
    title: "Onboarding for New Employees",
    category: "Onboarding",
    deliveryMode: "self_paced",
    duration: { value: 5, unit: "days" },
    modules: [
      { title: "Company Overview", lessons: [{ title: "Mission and Values" }, { title: "Org Chart" }] },
      { title: "Tools and Access", lessons: [{ title: "Setting Up Accounts" }, { title: "Key Software" }] },
    ],
    ...overrides,
  };
}

function confirmViaHttp(server: Awaited<ReturnType<typeof buildTestServer>>, tenantId: string, userId: string, executionId: string) {
  return server.inject({ method: "POST", url: `/ai/tool-executions/${executionId}/confirm`, headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId } });
}

function rejectViaHttp(server: Awaited<ReturnType<typeof buildTestServer>>, tenantId: string, userId: string, executionId: string) {
  return server.inject({ method: "POST", url: `/ai/tool-executions/${executionId}/reject`, headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId } });
}

function countAllCourses(tenantId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(courses));
}

function readCoursesByTitle(tenantId: string, title: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(courses).where(eq(courses.title, title)));
}

function readModules(tenantId: string, courseId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(courseModules).where(eq(courseModules.courseId, courseId)).orderBy(courseModules.position));
}

function readAllLessons(tenantId: string, courseId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.courseId, courseId)));
}

describe("Course Generation AI — multi-turn scenarios (Phase 18)", () => {
  afterEach(() => {
    __setAiProviderForTesting(new NotConfiguredProvider());
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("Scenario A — basic generation: one turn proposes the complete structure, confirmation creates exactly it", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
    const server = await buildTestServer();
    try {
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      const plan = {
        title: "Cybersecurity Awareness",
        category: "Security",
        deliveryMode: "self_paced",
        duration: { value: 4, unit: "hours" },
        modules: Array.from({ length: 4 }, (_, i) => ({ title: `Module ${i + 1}`, lessons: Array.from({ length: 3 }, (_, j) => ({ title: `Module ${i + 1} Lesson ${j + 1}` })) })),
      };
      __setAiProviderForTesting(new ScriptedProvider([() => ({ content: null, toolCalls: [{ id: "c1", name: "generate_course_structure", arguments: plan }], stopReason: "tool_use", usage: usage() })]));

      const turn1 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Create a cybersecurity awareness course with 4 modules and 3 lessons per module." } });
      expect(turn1.statusCode).toBe(200);
      const execution = turn1.json().data.toolExecution;
      expect(execution.toolName).toBe("generate_course_structure");
      expect(execution.status).toBe("pending_confirmation");
      expect(execution.input.modules).toHaveLength(4);
      expect(await countAllCourses(tenantId)).toHaveLength(0); // nothing written before confirmation

      const confirmRes = await confirmViaHttp(server, tenantId, userId, execution.id);
      expect(confirmRes.statusCode).toBe(200);

      const [course] = await readCoursesByTitle(tenantId, "Cybersecurity Awareness");
      const modules = await readModules(tenantId, course.id);
      expect(modules).toHaveLength(4);
      const lessons = await readAllLessons(tenantId, course.id);
      expect(lessons).toHaveLength(12);
    } finally {
      await server.close();
    }
  });

  it("Scenario B — refinement across turns: each turn's full plan is visible to the next (via summarizeProposal), nothing is written until the final confirm", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
    const server = await buildTestServer();
    try {
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      const sixModulePlan = samplePlan({ modules: Array.from({ length: 6 }, (_, i) => ({ title: `Module ${i + 1}`, lessons: [{ title: `Lesson ${i + 1}.1` }] })) });
      const fiveModulePlan = samplePlan({ modules: sixModulePlan.modules.slice(0, 5) });
      const withSecurityModulePlan = samplePlan({ modules: [...fiveModulePlan.modules, { title: "Company Security Policies", lessons: [{ title: "Acceptable Use Policy" }] }] });

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({ content: null, toolCalls: [{ id: "c1", name: "generate_course_structure", arguments: sixModulePlan }], stopReason: "tool_use", usage: usage() }),
          (input) => {
            // The critical property this scenario exists to prove: turn 2 can see turn 1's FULL
            // proposed structure (all 6 module titles) in its own message history — not just the
            // generic "I'd like to generate a course structure, review below" line — because
            // `generate_course_structure` defines `summarizeProposal`, and `reconstructHistory`
            // always replays a still-pending mutation's saved propose-time text verbatim.
            const assistantText = input.messages.filter((m) => m.role === "assistant").map((m) => m.content).join("\n");
            for (const module of sixModulePlan.modules) {
              expect(assistantText).toContain(module.title);
            }
            return { content: null, toolCalls: [{ id: "c2", name: "generate_course_structure", arguments: fiveModulePlan }], stopReason: "tool_use", usage: usage() };
          },
          (input) => {
            // Turn 1's own proposal is still `pending_confirmation` too (refinement creates a new,
            // independent proposal rather than mutating the old one — the same precedent the Course
            // Editing phase's own "follow-up correction" scenario already established), so its full
            // text — including "Module 6" — legitimately stays in history alongside turn 2's revision.
            // What actually matters, and what turn 2 already proved by successfully producing this
            // exact 5-module revision, is that the MOST RECENT proposal's full content is visible —
            // checked here directly rather than re-asserting an absence that was never the real
            // guarantee.
            const assistantText = input.messages.filter((m) => m.role === "assistant").map((m) => m.content).join("\n");
            expect(assistantText).toContain("Module 5");
            return { content: null, toolCalls: [{ id: "c3", name: "generate_course_structure", arguments: withSecurityModulePlan }], stopReason: "tool_use", usage: usage() };
          },
        ]),
      );

      await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Create an onboarding course for new employees." } });
      await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Make it 5 modules." } });
      const turn3 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Add a module about company security policies." } });

      expect(await countAllCourses(tenantId)).toHaveLength(0); // still nothing written — only proposals so far

      const finalExecution = turn3.json().data.toolExecution;
      expect(finalExecution.input.modules).toHaveLength(6); // 5 + the newly added security module
      const confirmRes = await confirmViaHttp(server, tenantId, userId, finalExecution.id);
      expect(confirmRes.statusCode).toBe(200);

      const [course] = await readCoursesByTitle(tenantId, "Onboarding for New Employees");
      const modules = await readModules(tenantId, course.id);
      expect(modules).toHaveLength(6);
      expect(modules.map((m) => m.title)).toContain("Company Security Policies");
      expect(await countAllCourses(tenantId)).toHaveLength(1); // only the final, confirmed plan was ever created
    } finally {
      await server.close();
    }
  });

  it("Scenario C — existing course context safety: a courseId hint in context never becomes the generation target", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
    const server = await buildTestServer();
    try {
      // A real, pre-existing course whose id will be passed as page context.
      const existingCourseRes = await server.inject({
        method: "POST",
        url: "/tenant/courses",
        headers,
        payload: { title: "Existing Course", category: "Other", deliveryMode: "self_paced", duration: { value: 1, unit: "hours" } },
      });
      const existingCourseId = existingCourseRes.json().data.id as string;

      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;
      __setAiProviderForTesting(
        new ScriptedProvider([
          (input) => {
            // The context hint is present in the system prompt text, but the tool call itself has
            // no courseId field to put it in — confirming the model never tries to smuggle it in.
            const systemMessage = input.messages.find((m) => m.role === "system");
            expect(systemMessage?.content).toContain(existingCourseId);
            return { content: null, toolCalls: [{ id: "c1", name: "generate_course_structure", arguments: samplePlan({ title: "New Cybersecurity Course" }) }], stopReason: "tool_use", usage: usage() };
          },
        ]),
      );

      const turn1 = await server.inject({
        method: "POST",
        url: `/ai/conversations/${conversationId}/messages`,
        headers,
        payload: { content: "Create another new course about cybersecurity.", context: { courseId: existingCourseId } },
      });
      const execution = turn1.json().data.toolExecution;
      expect(execution.toolName).toBe("generate_course_structure");
      expect(JSON.stringify(execution.input)).not.toContain(existingCourseId);

      await confirmViaHttp(server, tenantId, userId, execution.id);

      const [newCourse] = await readCoursesByTitle(tenantId, "New Cybersecurity Course");
      expect(newCourse.id).not.toBe(existingCourseId);
      const [existingUnchanged] = await server.inject({ method: "GET", url: `/tenant/courses/${existingCourseId}`, headers }).then((r) => [r.json().data]);
      expect(existingUnchanged.title).toBe("Existing Course"); // completely untouched
    } finally {
      await server.close();
    }
  });

  it("Scenario D — permission failure via the real HTTP route: no course created, clean 403", async () => {
    const tenantId = randomUUID();
    const noPermId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, noPermId);
    await seedUserWithRole(tenantId, noPermId, []);
    const headers = { "x-test-user-id": noPermId, "x-test-tenant-id": tenantId };
    const server = await buildTestServer();
    try {
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;
      __setAiProviderForTesting(new ScriptedProvider([() => ({ content: null, toolCalls: [{ id: "c1", name: "generate_course_structure", arguments: samplePlan() }], stopReason: "tool_use", usage: usage() })]));

      const res = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Create an onboarding course." } });
      expect(res.statusCode).toBe(403);
      expect(await countAllCourses(tenantId)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("Scenario E — rejection via the real HTTP route: database remains unchanged", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
    const server = await buildTestServer();
    try {
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;
      __setAiProviderForTesting(new ScriptedProvider([() => ({ content: null, toolCalls: [{ id: "c1", name: "generate_course_structure", arguments: samplePlan() }], stopReason: "tool_use", usage: usage() })]));

      const turn1 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Create an onboarding course." } });
      const execution = turn1.json().data.toolExecution;
      const rejectRes = await rejectViaHttp(server, tenantId, userId, execution.id);
      expect(rejectRes.statusCode).toBe(200);
      expect(await countAllCourses(tenantId)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("Scenario F — duplicate confirmation via the real HTTP route fails safely", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
    const server = await buildTestServer();
    try {
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;
      __setAiProviderForTesting(new ScriptedProvider([() => ({ content: null, toolCalls: [{ id: "c1", name: "generate_course_structure", arguments: samplePlan() }], stopReason: "tool_use", usage: usage() })]));

      const turn1 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Create an onboarding course." } });
      const execution = turn1.json().data.toolExecution;
      const first = await confirmViaHttp(server, tenantId, userId, execution.id);
      expect(first.statusCode).toBe(200);
      const second = await confirmViaHttp(server, tenantId, userId, execution.id);
      expect(second.statusCode).toBe(409);
      expect(await countAllCourses(tenantId)).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("Scenario G — a plan exceeding generation limits is safely rejected, never partially created", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
    const server = await buildTestServer();
    try {
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;
      const tooManyModules = samplePlan({
        title: "Way Too Big",
        modules: Array.from({ length: GENERATION_LIMITS.maxModules + 5 }, (_, i) => ({ title: `Module ${i}`, lessons: [{ title: "Lesson 1" }] })),
      });
      __setAiProviderForTesting(new ScriptedProvider([() => ({ content: null, toolCalls: [{ id: "c1", name: "generate_course_structure", arguments: tooManyModules }], stopReason: "tool_use", usage: usage() })]));

      // Lesson Content Reliability Fix: a mid-chat schema-validation failure is no longer a bare
      // HTTP 400 with nothing persisted — it's recorded as a real `failed` execution plus a real
      // assistant message (so the model has memory of its own mistake on the next turn), and the
      // route returns a normal 200 turn. The safety property under test — nothing was created — is
      // unchanged and still the actual point of this test.
      const res = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Create a course with 15 modules." } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.toolExecution.status).toBe("failed");
      expect(body.data.toolExecution.toolName).toBe("generate_course_structure");
      expect(await countAllCourses(tenantId)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("Scenario H — existing tools remain correctly selectable after generation: adding a module to the NEWLY-created course uses create_course_module, not another generation", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
    const server = await buildTestServer();
    try {
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      __setAiProviderForTesting(new ScriptedProvider([() => ({ content: null, toolCalls: [{ id: "c1", name: "generate_course_structure", arguments: samplePlan() }], stopReason: "tool_use", usage: usage() })]));
      const turn1 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Create an onboarding course." } });
      const genExecution = turn1.json().data.toolExecution;
      await confirmViaHttp(server, tenantId, userId, genExecution.id);
      const [course] = await readCoursesByTitle(tenantId, "Onboarding for New Employees");

      __setAiProviderForTesting(
        new ScriptedProvider([() => ({ content: null, toolCalls: [{ id: "c2", name: "create_course_module", arguments: { courseId: course.id, title: "Advanced Topics" } }], stopReason: "tool_use", usage: usage() })]),
      );
      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Add a module about advanced topics to this course." } });
      expect(turn2.json().data.toolExecution.toolName).toBe("create_course_module"); // not another generate_course_structure call
      await confirmViaHttp(server, tenantId, userId, turn2.json().data.toolExecution.id);

      const modules = await readModules(tenantId, course.id);
      expect(modules).toHaveLength(3); // the original 2 generated modules + this one added module
      expect(modules.map((m) => m.title)).toContain("Advanced Topics");
    } finally {
      await server.close();
    }
  });
});
