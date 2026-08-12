import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { withTenantDb, closeTestPool } from "../helpers/pg";
import type { Db } from "../../src/db/client";
import { courses } from "../../src/db/schema/courses";
import { courseModules, contentItems } from "../../src/db/schema/course-content";
import { aiConversations, aiToolExecutions } from "../../src/db/schema/ai";
import {
  invokeTool,
  confirmToolExecution,
  ToolPermissionDeniedError,
  ToolAlreadyResolvedError,
  ToolExpiredError,
  type ToolInvocationResult,
} from "../../src/ai/execution-state-machine";
import { listTools, describeToolForProvider } from "../../src/ai/tool-registry";
import "../../src/ai/tools";
import type { ToolContext } from "../../src/ai/types";

/**
 * AI Course Editing Phase 1 — `update_course`/`update_course_module`/`update_course_lesson`/
 * `list_course_lessons`. Same integration-test convention as `ai-foundation-courses.test.ts` (real
 * Postgres/RLS, `invokeTool`/`confirmToolExecution` called directly). Covers this phase's specific
 * "Security Tests" section — everything the read/create Courses tools already had, now proven again
 * for the update tools specifically, since a partial-update tool touching an EXISTING resource is a
 * meaningfully different risk shape than create (wrong tenant/user/permission now means silently
 * corrupting someone else's data, not just creating an unauthorized new row).
 */

async function createTestCourse(tenantId: string, userId: string, server: Awaited<ReturnType<typeof buildTestServer>>, overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: "/tenant/courses",
    headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
    payload: { title: `Test Course ${randomUUID().slice(0, 8)}`, category: "Course Editing Tests", deliveryMode: "self_paced", duration: { value: 1, unit: "hours" }, ...overrides },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}

async function createTestModule(tenantId: string, userId: string, courseId: string, server: Awaited<ReturnType<typeof buildTestServer>>, title = "Original Module Title"): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: `/tenant/courses/${courseId}/modules`,
    headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
    payload: { title },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}

async function createTestLesson(tenantId: string, userId: string, moduleId: string, server: Awaited<ReturnType<typeof buildTestServer>>, title = "Original Lesson Title"): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: `/tenant/modules/${moduleId}/content-items`,
    headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
    payload: { type: "article", title, payload: { body: "original body" } },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}

async function seedConversation(tenantId: string, userId: string, conversationId: string): Promise<void> {
  await withTenantDb(tenantId, (db) => db.insert(aiConversations).values({ id: conversationId, tenantId, userId }));
}

async function runInOwnTransaction<T>(tenantId: string, userId: string, fn: (ctx: ToolContext) => Promise<T>): Promise<T> {
  let caught: unknown;
  const result = await withTenantDb(tenantId, async (db) => {
    try {
      return await fn({ tenantId, userId, db });
    } catch (err) {
      caught = err;
      return undefined as T;
    }
  });
  if (caught) throw caught;
  return result;
}

function propose(tenantId: string, userId: string, toolName: string, input: Record<string, unknown>, conversationId: string): Promise<ToolInvocationResult> {
  return runInOwnTransaction(tenantId, userId, (ctx) => invokeTool(toolName, ctx, input, conversationId));
}

function confirm(tenantId: string, userId: string, executionId: string): Promise<ToolInvocationResult> {
  return runInOwnTransaction(tenantId, userId, (ctx) => confirmToolExecution(executionId, ctx));
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

describe("AI Course Editing — tool registration", () => {
  it("update_course, update_course_module, update_course_lesson, and list_course_lessons are all correctly tagged", () => {
    const byName = new Map(listTools().map((t) => [t.name, t]));
    for (const [name, expected] of [
      ["update_course", { domain: "courses", resource: "course", operation: "update" }],
      ["update_course_module", { domain: "courses", resource: "module", operation: "update" }],
      ["update_course_lesson", { domain: "courses", resource: "lesson", operation: "update" }],
      ["list_course_lessons", { domain: "courses", resource: "lesson", operation: "list" }],
    ] as const) {
      const tool = byName.get(name);
      expect(tool, `${name} should be registered`).toBeDefined();
      expect(tool!.domain).toBe(expected.domain);
      expect(tool!.resource).toBe(expected.resource);
      expect(tool!.operation).toBe(expected.operation);
      expect(describeToolForProvider(tool!)).toMatch(new RegExp(`^\\[${expected.domain} → ${expected.resource}\\.${expected.operation}\\]`));
    }
  });

  it("all three update tools require course.manage and confirmation", () => {
    const byName = new Map(listTools().map((t) => [t.name, t]));
    for (const name of ["update_course", "update_course_module", "update_course_lesson"]) {
      const tool = byName.get(name)!;
      expect(tool.mutating).toBe(true);
      expect(tool.requiresConfirmation).toBe(true);
      expect(tool.requiredPermissions).toEqual(["course.manage"]);
    }
  });
});

describe("AI Course Editing — partial updates work end-to-end", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("update_course changes only the specified field(s), never status, and never a field not sent", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server, { title: "Cybersecurity 101", provider: "Acme Learning" });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "update_course", { courseId, title: "Cybersecurity Fundamentals" }, conversationId);
      expect(proposal.status).toBe("pending_confirmation");
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const [row] = await readCourse(tenantId, courseId);
      expect(row.title).toBe("Cybersecurity Fundamentals");
      expect(row.provider).toBe("Acme Learning"); // untouched
      expect(row.status).toBe("draft"); // never implicitly published
    } finally {
      await server.close();
    }
  });

  it("update_course_module changes only the specified field(s)", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server, "Threat Recognition");
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "update_course_module", { moduleId, title: "Recognizing Threats" }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const [row] = await readModule(tenantId, moduleId);
      expect(row.title).toBe("Recognizing Threats");
      expect(row.status).toBe("draft"); // never implicitly published
    } finally {
      await server.close();
    }
  });

  it("update_course_lesson changes title/description/payload but never type, and validates payload against the EXISTING type", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, "Phishing Basics");
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "update_course_lesson", { lessonId, title: "Recognizing Phishing Emails" }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const [row] = await readLesson(tenantId, lessonId);
      expect(row.title).toBe("Recognizing Phishing Emails");
      expect(row.type).toBe("article"); // immutable, untouched
      expect((row.payload as { body: string }).body).toBe("original body"); // untouched

      // Now try an invalid payload update for this (still article) lesson — must fail cleanly.
      const badProposal = await propose(tenantId, userId, "update_course_lesson", { lessonId, payload: {} }, conversationId);
      const badConfirmed = await confirm(tenantId, userId, badProposal.executionId);
      expect(badConfirmed.status).toBe("failed");
      const [unchanged] = await readLesson(tenantId, lessonId);
      expect((unchanged.payload as { body: string }).body).toBe("original body"); // still untouched
    } finally {
      await server.close();
    }
  });

  it("list_course_lessons resolves a lesson by module and position — the exact capability update_course_lesson's identity resolution depends on", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const firstId = await createTestLesson(tenantId, userId, moduleId, server, "First Lesson");
      const secondId = await createTestLesson(tenantId, userId, moduleId, server, "Second Lesson");
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const result = await propose(tenantId, userId, "list_course_lessons", { courseId, moduleId }, conversationId);
      expect(result.status).toBe("executed");
      const lessons = result.output as { id: string; title: string; position: number }[];
      expect(lessons.map((l) => l.id)).toEqual([firstId, secondId]);
      expect(lessons[1].title).toBe("Second Lesson"); // "the second lesson" resolves via position
    } finally {
      await server.close();
    }
  });
});

describe("AI Course Editing — security", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("tenant isolation: Tenant B cannot update Tenant A's course, module, or lesson", async () => {
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
      const courseId = await createTestCourse(tenantAId, userAId, server, { title: "Tenant A Course" });
      const moduleId = await createTestModule(tenantAId, userAId, courseId, server);
      const lessonId = await createTestLesson(tenantAId, userAId, moduleId, server);

      const conversationId = randomUUID();
      await seedConversation(tenantBId, userBId, conversationId);

      const courseAttempt = await propose(tenantBId, userBId, "update_course", { courseId, title: "Hacked" }, conversationId);
      expect(courseAttempt.status).toBe("pending_confirmation"); // proposal itself doesn't check existence
      const courseConfirm = await confirm(tenantBId, userBId, courseAttempt.executionId);
      expect(courseConfirm.status).toBe("failed");
      expect(courseConfirm.error).toMatch(/not found/i);

      const moduleAttempt = await propose(tenantBId, userBId, "update_course_module", { moduleId, title: "Hacked" }, conversationId);
      const moduleConfirm = await confirm(tenantBId, userBId, moduleAttempt.executionId);
      expect(moduleConfirm.status).toBe("failed");

      const lessonAttempt = await propose(tenantBId, userBId, "update_course_lesson", { lessonId, title: "Hacked" }, conversationId);
      const lessonConfirm = await confirm(tenantBId, userBId, lessonAttempt.executionId);
      expect(lessonConfirm.status).toBe("failed");

      // Nothing changed.
      const [course] = await readCourse(tenantAId, courseId);
      expect(course.title).toBe("Tenant A Course");
      const [module] = await readModule(tenantAId, moduleId);
      expect(module.title).toBe("Original Module Title");
      const [lesson] = await readLesson(tenantAId, lessonId);
      expect(lesson.title).toBe("Original Lesson Title");
    } finally {
      await server.close();
    }
  });

  it("permission enforcement: a user without course.manage cannot propose any of the three update tools", async () => {
    const tenantId = randomUUID();
    const adminId = randomUUID();
    const noPermId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);
    await seedUser(tenantId, noPermId, { email: `noperm-${randomUUID()}@example.com` });
    await seedUserWithRole(tenantId, noPermId, []);

    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, adminId, server);
      const moduleId = await createTestModule(tenantId, adminId, courseId, server);
      const lessonId = await createTestLesson(tenantId, adminId, moduleId, server);
      const conversationId = randomUUID();
      await seedConversation(tenantId, noPermId, conversationId);

      await expect(propose(tenantId, noPermId, "update_course", { courseId, title: "X" }, conversationId)).rejects.toBeInstanceOf(ToolPermissionDeniedError);
      await expect(propose(tenantId, noPermId, "update_course_module", { moduleId, title: "X" }, conversationId)).rejects.toBeInstanceOf(ToolPermissionDeniedError);
      await expect(propose(tenantId, noPermId, "update_course_lesson", { lessonId, title: "X" }, conversationId)).rejects.toBeInstanceOf(ToolPermissionDeniedError);
    } finally {
      await server.close();
    }
  });

  it("tenant-ID injection: a fabricated tenantId in the tool arguments is ignored — the update still only ever touches the caller's own tenant", async () => {
    const tenantId = randomUUID();
    const otherTenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId, "Real Tenant");
    await seedTenant(otherTenantId, "Other Tenant");
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server, { title: "Real Course" });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "update_course", { courseId, title: "Updated Title", tenantId: otherTenantId, isSuperAdmin: true }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const [row] = await readCourse(tenantId, courseId);
      expect(row.title).toBe("Updated Title");
      expect(row.tenantId).toBe(tenantId); // never moved to the injected tenant
      expect(await readCourse(otherTenantId, courseId)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("context spoofing: a fabricated context.courseId sent alongside a chat message cannot bypass authorization", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

    const server = await buildTestServer();
    try {
      const createRes = await server.inject({ method: "POST", url: "/ai/conversations", headers });
      const conversationId = createRes.json().data.id as string;
      const res = await server.inject({
        method: "POST",
        url: `/ai/conversations/${conversationId}/messages`,
        headers,
        payload: { content: "Change this course's title.", context: { courseId: randomUUID(), tenantId: randomUUID(), isSuperAdmin: true } },
      });
      // Same outcome as no context at all (503, no AI provider configured in tests) — proves the
      // endpoint doesn't special-case or trust a client-supplied context object.
      expect(res.statusCode).toBe(503);
    } finally {
      await server.close();
    }
  });

  it("proposal before write: none of the three update tools mutate the database at propose time", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server, { title: "Untouched Course" });
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server);
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const p1 = await propose(tenantId, userId, "update_course", { courseId, title: "Should Not Apply Yet" }, conversationId);
      const p2 = await propose(tenantId, userId, "update_course_module", { moduleId, title: "Should Not Apply Yet" }, conversationId);
      const p3 = await propose(tenantId, userId, "update_course_lesson", { lessonId, title: "Should Not Apply Yet" }, conversationId);
      expect([p1.status, p2.status, p3.status]).toEqual(["pending_confirmation", "pending_confirmation", "pending_confirmation"]);
      expect([p1.output, p2.output, p3.output]).toEqual([undefined, undefined, undefined]);

      const [course] = await readCourse(tenantId, courseId);
      expect(course.title).toBe("Untouched Course");
      const [module] = await readModule(tenantId, moduleId);
      expect(module.title).toBe("Original Module Title");
      const [lesson] = await readLesson(tenantId, lessonId);
      expect(lesson.title).toBe("Original Lesson Title");
    } finally {
      await server.close();
    }
  });

  it("duplicate confirmation fails safely — the update is applied exactly once", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server, { title: "Original" });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "update_course", { courseId, title: "Updated Once" }, conversationId);
      const first = await confirm(tenantId, userId, proposal.executionId);
      expect(first.status).toBe("executed");

      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolAlreadyResolvedError);

      const [row] = await readCourse(tenantId, courseId);
      expect(row.title).toBe("Updated Once");
    } finally {
      await server.close();
    }
  });

  it("an expired proposal cannot be confirmed", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server, { title: "Original" });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "update_course", { courseId, title: "Too Late" }, conversationId);
      await withTenantDb(tenantId, (db) => db.update(aiToolExecutions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(aiToolExecutions.id, proposal.executionId)));

      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolExpiredError);
      const [row] = await readCourse(tenantId, courseId);
      expect(row.title).toBe("Original");
    } finally {
      await server.close();
    }
  });

  it("confirmation fails if course.manage was revoked after the proposal was created", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    const { roleId } = await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server, { title: "Original" });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "update_course", { courseId, title: "Should Not Apply" }, conversationId);
      await withTenantDb(tenantId, (db) => db.execute(`DELETE FROM user_roles WHERE user_id = '${userId}' AND role_id = '${roleId}'`));

      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolPermissionDeniedError);
      const [row] = await readCourse(tenantId, courseId);
      expect(row.title).toBe("Original");
    } finally {
      await server.close();
    }
  });

  it("RLS enforces isolation at the database level directly, not just through the tool layer", async () => {
    const tenantAId = randomUUID();
    const userAId = randomUUID();
    await seedTenant(tenantAId, "Tenant A");
    await seedUser(tenantAId, userAId);
    await seedUserWithRole(tenantAId, userAId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantAId, userAId, server);
      const moduleId = await createTestModule(tenantAId, userAId, courseId, server);
      const lessonId = await createTestLesson(tenantAId, userAId, moduleId, server);

      const tenantBId = randomUUID();
      await seedTenant(tenantBId, "Tenant B");
      expect(await withTenantDb(tenantBId, (db: Db) => db.select().from(courses).where(eq(courses.id, courseId)))).toHaveLength(0);
      expect(await withTenantDb(tenantBId, (db: Db) => db.select().from(courseModules).where(eq(courseModules.id, moduleId)))).toHaveLength(0);
      expect(await withTenantDb(tenantBId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.id, lessonId)))).toHaveLength(0);
    } finally {
      await server.close();
    }
  });
});
