import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { withTenantDb, closeTestPool } from "../helpers/pg";
import type { Db } from "../../src/db/client";
import { courseModules, contentItems } from "../../src/db/schema/course-content";
import { aiConversations, aiToolExecutions } from "../../src/db/schema/ai";
import { invokeTool, confirmToolExecution, ToolPermissionDeniedError, ToolAlreadyResolvedError, ToolExpiredError, type ToolInvocationResult } from "../../src/ai/execution-state-machine";
import { listTools, describeToolForProvider } from "../../src/ai/tool-registry";
import "../../src/ai/tools";
import type { ToolContext } from "../../src/ai/types";

/**
 * Course Organization AI Phase 1 — `reorder_course_modules`/`reorder_course_lessons`/
 * `archive_course_module`/`archive_course_lesson`. Same integration-test convention as
 * `ai-foundation-course-editing.test.ts` (real Postgres/RLS, `invokeTool`/`confirmToolExecution`
 * called directly). Covers this phase's "Phase 16 — Security Tests" list plus reorder-specific
 * "Phase 9 — Reordering Safety" and "Phase 8 — Status Safety" requirements.
 */

async function createTestCourse(tenantId: string, userId: string, server: Awaited<ReturnType<typeof buildTestServer>>, overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: "/tenant/courses",
    headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
    payload: { title: `Test Course ${randomUUID().slice(0, 8)}`, category: "Course Organization Tests", deliveryMode: "self_paced", duration: { value: 1, unit: "hours" }, ...overrides },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}

async function createTestModule(tenantId: string, userId: string, courseId: string, server: Awaited<ReturnType<typeof buildTestServer>>, title = "Module"): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: `/tenant/courses/${courseId}/modules`,
    headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
    payload: { title },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}

async function createTestLesson(tenantId: string, userId: string, moduleId: string, server: Awaited<ReturnType<typeof buildTestServer>>, title = "Lesson"): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: `/tenant/modules/${moduleId}/content-items`,
    headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
    payload: { type: "article", title, payload: { body: "..." } },
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

function readModules(tenantId: string, courseId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(courseModules).where(eq(courseModules.courseId, courseId)).orderBy(courseModules.position));
}

function readModule(tenantId: string, moduleId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(courseModules).where(eq(courseModules.id, moduleId)));
}

function readLessons(tenantId: string, moduleId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.moduleId, moduleId)).orderBy(contentItems.position));
}

function readLesson(tenantId: string, lessonId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.id, lessonId)));
}

describe("Course Organization AI — tool registration", () => {
  it("all four tools are correctly tagged, mutating, confirmation-gated, and permission-gated", () => {
    const byName = new Map(listTools().map((t) => [t.name, t]));
    for (const [name, expected] of [
      ["reorder_course_modules", { domain: "courses", resource: "module", operation: "reorder" }],
      ["reorder_course_lessons", { domain: "courses", resource: "lesson", operation: "reorder" }],
      ["archive_course_module", { domain: "courses", resource: "module", operation: "archive" }],
      ["archive_course_lesson", { domain: "courses", resource: "lesson", operation: "archive" }],
    ] as const) {
      const tool = byName.get(name);
      expect(tool, `${name} should be registered`).toBeDefined();
      expect(tool!.domain).toBe(expected.domain);
      expect(tool!.resource).toBe(expected.resource);
      expect(tool!.operation).toBe(expected.operation);
      expect(describeToolForProvider(tool!)).toMatch(new RegExp(`^\\[${expected.domain} → ${expected.resource}\\.${expected.operation}\\]`));
      expect(tool!.mutating).toBe(true);
      expect(tool!.requiresConfirmation).toBe(true);
      expect(tool!.requiredPermissions).toEqual(["course.manage"]);
    }
  });
});

describe("Course Organization AI — reorder behavior and safety", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("reorder_course_modules changes position to match the proposed order", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const a = await createTestModule(tenantId, userId, courseId, server, "A");
      const b = await createTestModule(tenantId, userId, courseId, server, "B");
      const c = await createTestModule(tenantId, userId, courseId, server, "C");
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(
        tenantId,
        userId,
        "reorder_course_modules",
        { courseId, modules: [{ id: c, title: "C" }, { id: a, title: "A" }, { id: b, title: "B" }] },
        conversationId,
      );
      expect(proposal.status).toBe("pending_confirmation");
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const modules = await readModules(tenantId, courseId);
      expect(modules.map((m) => m.id)).toEqual([c, a, b]);
      expect(modules.map((m) => m.position)).toEqual([0, 1, 2]);
    } finally {
      await server.close();
    }
  });

  it("reorder_course_lessons changes position within one module, scoped correctly", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const l1 = await createTestLesson(tenantId, userId, moduleId, server, "First");
      const l2 = await createTestLesson(tenantId, userId, moduleId, server, "Second");
      const l3 = await createTestLesson(tenantId, userId, moduleId, server, "Third");
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(
        tenantId,
        userId,
        "reorder_course_lessons",
        { moduleId, lessons: [{ id: l3, title: "Third" }, { id: l1, title: "First" }, { id: l2, title: "Second" }] },
        conversationId,
      );
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const lessons = await readLessons(tenantId, moduleId);
      expect(lessons.map((l) => l.id)).toEqual([l3, l1, l2]);
    } finally {
      await server.close();
    }
  });

  it("invalid ordering: a list missing a module is rejected safely, order unchanged", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const a = await createTestModule(tenantId, userId, courseId, server, "A");
      const b = await createTestModule(tenantId, userId, courseId, server, "B");
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      // Omits module b.
      const proposal = await propose(tenantId, userId, "reorder_course_modules", { courseId, modules: [{ id: a, title: "A" }] }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("failed");

      const modules = await readModules(tenantId, courseId);
      expect(modules.map((m) => m.id)).toEqual([a, b]);
      expect(modules.map((m) => m.position)).toEqual([0, 1]);
    } finally {
      await server.close();
    }
  });

  it("invalid ordering: a duplicated id is rejected safely, order unchanged", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const a = await createTestModule(tenantId, userId, courseId, server, "A");
      const b = await createTestModule(tenantId, userId, courseId, server, "B");
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      // Duplicates module a, omits module b (same length as current, still invalid).
      const proposal = await propose(tenantId, userId, "reorder_course_modules", { courseId, modules: [{ id: a, title: "A" }, { id: a, title: "A" }] }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("failed");

      const modules = await readModules(tenantId, courseId);
      expect(modules.map((m) => m.id)).toEqual([a, b]);
    } finally {
      await server.close();
    }
  });

  it("parent validation: a lesson from a DIFFERENT module cannot be smuggled into a reorder — rejected safely, both modules unchanged", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleA = await createTestModule(tenantId, userId, courseId, server, "Module A");
      const moduleB = await createTestModule(tenantId, userId, courseId, server, "Module B");
      const lessonInA = await createTestLesson(tenantId, userId, moduleA, server, "In A");
      const lessonInB = await createTestLesson(tenantId, userId, moduleB, server, "In B");
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      // Attempts to reorder Module A's lessons, but supplies Module B's lesson instead of A's own.
      const proposal = await propose(tenantId, userId, "reorder_course_lessons", { moduleId: moduleA, lessons: [{ id: lessonInB, title: "In B" }] }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("failed");

      const [rowA] = await readLesson(tenantId, lessonInA);
      const [rowB] = await readLesson(tenantId, lessonInB);
      expect(rowA.moduleId).toBe(moduleA);
      expect(rowA.position).toBe(0);
      expect(rowB.moduleId).toBe(moduleB); // never moved between modules
      expect(rowB.position).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("cross-course module id cannot be reordered into another course's module list", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseA = await createTestCourse(tenantId, userId, server, { title: "Course A" });
      const courseB = await createTestCourse(tenantId, userId, server, { title: "Course B" });
      const moduleInA = await createTestModule(tenantId, userId, courseA, server, "In A");
      const moduleInB = await createTestModule(tenantId, userId, courseB, server, "In B");
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "reorder_course_modules", { courseId: courseA, modules: [{ id: moduleInB, title: "In B" }] }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("failed");

      const [rowA] = await readModule(tenantId, moduleInA);
      const [rowB] = await readModule(tenantId, moduleInB);
      expect(rowA.courseId).toBe(courseA);
      expect(rowB.courseId).toBe(courseB);
    } finally {
      await server.close();
    }
  });
});

describe("Course Organization AI — archive behavior and status safety", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("archive_course_module sets status to archived without deleting or reordering anything", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server, "Outdated Module");
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server);
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "archive_course_module", { moduleId, title: "Outdated Module" }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const [module] = await readModule(tenantId, moduleId);
      expect(module.status).toBe("archived");
      expect(module.title).toBe("Outdated Module"); // untouched

      const [lesson] = await readLesson(tenantId, lessonId);
      expect(lesson.status).toBe("draft"); // archiving a module never cascades a status change to its lessons
      expect(lesson.moduleId).toBe(moduleId); // never removed/detached
    } finally {
      await server.close();
    }
  });

  it("archive_course_lesson sets status to archived without touching type, payload, or module membership", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, "Outdated Lesson");
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "archive_course_lesson", { lessonId, title: "Outdated Lesson" }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const [lesson] = await readLesson(tenantId, lessonId);
      expect(lesson.status).toBe("archived");
      expect(lesson.type).toBe("article");
      expect(lesson.moduleId).toBe(moduleId);
    } finally {
      await server.close();
    }
  });

  it("archiving an already-archived module is a safe no-op, not an error (no restricted transition graph)", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const first = await propose(tenantId, userId, "archive_course_module", { moduleId, title: "Module" }, conversationId);
      expect((await confirm(tenantId, userId, first.executionId)).status).toBe("executed");

      const second = await propose(tenantId, userId, "archive_course_module", { moduleId, title: "Module" }, conversationId);
      const secondConfirmed = await confirm(tenantId, userId, second.executionId);
      expect(secondConfirmed.status).toBe("executed"); // not rejected as "already archived"

      const [module] = await readModule(tenantId, moduleId);
      expect(module.status).toBe("archived");
    } finally {
      await server.close();
    }
  });

  it("archiving a published module works the same as archiving a draft one", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      await server.inject({
        method: "PATCH",
        url: `/tenant/modules/${moduleId}`,
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: { status: "published" },
      });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "archive_course_module", { moduleId, title: "Module" }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const [module] = await readModule(tenantId, moduleId);
      expect(module.status).toBe("archived");
    } finally {
      await server.close();
    }
  });
});

describe("Course Organization AI — security", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("tenant isolation: Tenant B cannot reorder or archive Tenant A's modules/lessons", async () => {
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
      const courseId = await createTestCourse(tenantAId, userAId, server);
      const moduleId = await createTestModule(tenantAId, userAId, courseId, server, "Tenant A Module");
      const lessonId = await createTestLesson(tenantAId, userAId, moduleId, server, "Tenant A Lesson");

      const conversationId = randomUUID();
      await seedConversation(tenantBId, userBId, conversationId);

      const reorderModulesAttempt = await propose(tenantBId, userBId, "reorder_course_modules", { courseId, modules: [{ id: moduleId, title: "Hacked" }] }, conversationId);
      expect((await confirm(tenantBId, userBId, reorderModulesAttempt.executionId)).status).toBe("failed");

      const reorderLessonsAttempt = await propose(tenantBId, userBId, "reorder_course_lessons", { moduleId, lessons: [{ id: lessonId, title: "Hacked" }] }, conversationId);
      expect((await confirm(tenantBId, userBId, reorderLessonsAttempt.executionId)).status).toBe("failed");

      const archiveModuleAttempt = await propose(tenantBId, userBId, "archive_course_module", { moduleId, title: "Hacked" }, conversationId);
      expect((await confirm(tenantBId, userBId, archiveModuleAttempt.executionId)).status).toBe("failed");

      const archiveLessonAttempt = await propose(tenantBId, userBId, "archive_course_lesson", { lessonId, title: "Hacked" }, conversationId);
      expect((await confirm(tenantBId, userBId, archiveLessonAttempt.executionId)).status).toBe("failed");

      const [module] = await readModule(tenantAId, moduleId);
      const [lesson] = await readLesson(tenantAId, lessonId);
      expect(module.title).toBe("Tenant A Module");
      expect(module.status).toBe("draft");
      expect(lesson.title).toBe("Tenant A Lesson");
      expect(lesson.status).toBe("draft");
    } finally {
      await server.close();
    }
  });

  it("permission enforcement: a user without course.manage cannot propose any of the four tools", async () => {
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

      await expect(propose(tenantId, noPermId, "reorder_course_modules", { courseId, modules: [{ id: moduleId, title: "X" }] }, conversationId)).rejects.toBeInstanceOf(ToolPermissionDeniedError);
      await expect(propose(tenantId, noPermId, "reorder_course_lessons", { moduleId, lessons: [{ id: lessonId, title: "X" }] }, conversationId)).rejects.toBeInstanceOf(ToolPermissionDeniedError);
      await expect(propose(tenantId, noPermId, "archive_course_module", { moduleId, title: "X" }, conversationId)).rejects.toBeInstanceOf(ToolPermissionDeniedError);
      await expect(propose(tenantId, noPermId, "archive_course_lesson", { lessonId, title: "X" }, conversationId)).rejects.toBeInstanceOf(ToolPermissionDeniedError);
    } finally {
      await server.close();
    }
  });

  it("tenant-ID injection: a fabricated tenantId in the tool arguments is ignored", async () => {
    const tenantId = randomUUID();
    const otherTenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId, "Real Tenant");
    await seedTenant(otherTenantId, "Other Tenant");
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server, "Real Module");
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "archive_course_module", { moduleId, title: "Real Module", tenantId: otherTenantId, isSuperAdmin: true }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const [row] = await readModule(tenantId, moduleId);
      expect(row.status).toBe("archived");
      expect(row.tenantId).toBe(tenantId); // never moved to the injected tenant
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
        payload: { content: "Archive that module.", context: { courseId: randomUUID(), tenantId: randomUUID(), isSuperAdmin: true } },
      });
      expect(res.statusCode).toBe(503);
    } finally {
      await server.close();
    }
  });

  it("proposal before write: none of the four tools mutate the database at propose time", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleA = await createTestModule(tenantId, userId, courseId, server, "A");
      const moduleB = await createTestModule(tenantId, userId, courseId, server, "B");
      const lessonId = await createTestLesson(tenantId, userId, moduleA, server);
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const p1 = await propose(tenantId, userId, "reorder_course_modules", { courseId, modules: [{ id: moduleB, title: "B" }, { id: moduleA, title: "A" }] }, conversationId);
      const p2 = await propose(tenantId, userId, "archive_course_module", { moduleId: moduleA, title: "A" }, conversationId);
      const p3 = await propose(tenantId, userId, "archive_course_lesson", { lessonId, title: "Lesson" }, conversationId);
      expect([p1.status, p2.status, p3.status]).toEqual(["pending_confirmation", "pending_confirmation", "pending_confirmation"]);

      const modules = await readModules(tenantId, courseId);
      expect(modules.map((m) => m.id)).toEqual([moduleA, moduleB]); // still original order
      const [module] = await readModule(tenantId, moduleA);
      expect(module.status).toBe("draft"); // not archived yet
      const [lesson] = await readLesson(tenantId, lessonId);
      expect(lesson.status).toBe("draft"); // not archived yet
    } finally {
      await server.close();
    }
  });

  it("duplicate confirmation fails safely — the mutation is applied exactly once", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "archive_course_module", { moduleId, title: "Module" }, conversationId);
      const first = await confirm(tenantId, userId, proposal.executionId);
      expect(first.status).toBe("executed");

      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolAlreadyResolvedError);
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
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "archive_course_module", { moduleId, title: "Module" }, conversationId);
      await withTenantDb(tenantId, (db) => db.update(aiToolExecutions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(aiToolExecutions.id, proposal.executionId)));

      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolExpiredError);
      const [module] = await readModule(tenantId, moduleId);
      expect(module.status).toBe("draft");
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
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "archive_course_module", { moduleId, title: "Module" }, conversationId);
      await withTenantDb(tenantId, (db) => db.execute(`DELETE FROM user_roles WHERE user_id = '${userId}' AND role_id = '${roleId}'`));

      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolPermissionDeniedError);
      const [module] = await readModule(tenantId, moduleId);
      expect(module.status).toBe("draft");
    } finally {
      await server.close();
    }
  });

  it("RLS enforces isolation at the database level directly", async () => {
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
      expect(await withTenantDb(tenantBId, (db: Db) => db.select().from(courseModules).where(eq(courseModules.id, moduleId)))).toHaveLength(0);
      expect(await withTenantDb(tenantBId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.id, lessonId)))).toHaveLength(0);
    } finally {
      await server.close();
    }
  });
});
