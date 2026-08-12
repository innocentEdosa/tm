import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { withTenantDb, closeTestPool } from "../helpers/pg";
import type { Db } from "../../src/db/client";
import { contentItems } from "../../src/db/schema/course-content";
import { aiConversations, aiToolExecutions } from "../../src/db/schema/ai";
import { invokeTool, confirmToolExecution, ToolPermissionDeniedError, ToolAlreadyResolvedError, ToolExpiredError, ToolInputInvalidError, type ToolInvocationResult } from "../../src/ai/execution-state-machine";
import { listTools, describeToolForProvider } from "../../src/ai/tool-registry";
import "../../src/ai/tools";
import type { ToolContext } from "../../src/ai/types";

/**
 * AI Lesson Content & Assessment Generation phase — `get_course_lesson_content`,
 * `generate_lesson_content`, `generate_assessment`. Same integration-test convention as every prior
 * Courses-domain test file this session. Reuses `CourseService.createLesson`/`updateLesson`
 * verbatim (no new write method exists), so "failed generation leaves DB unchanged" reduces to
 * "a single UPDATE/INSERT statement either fully applies or doesn't" — no multi-step rollback
 * concern like `generate_course_structure` had.
 */

async function createTestCourse(tenantId: string, userId: string, server: Awaited<ReturnType<typeof buildTestServer>>, overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: "/tenant/courses",
    headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
    payload: { title: `Test Course ${randomUUID().slice(0, 8)}`, category: "Lesson Content Tests", deliveryMode: "self_paced", duration: { value: 1, unit: "hours" }, ...overrides },
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

async function createTestLesson(tenantId: string, userId: string, moduleId: string, server: Awaited<ReturnType<typeof buildTestServer>>, overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: `/tenant/modules/${moduleId}/content-items`,
    headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
    payload: { type: "article", title: "Lesson", payload: { body: "original body" }, ...overrides },
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

function readLesson(tenantId: string, lessonId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.id, lessonId)));
}

describe("Lesson Content AI — tool registration", () => {
  it("all three tools are correctly tagged", () => {
    const byName = new Map(listTools().map((t) => [t.name, t]));
    for (const [name, expected] of [
      ["get_course_lesson_content", { domain: "courses", resource: "lesson", operation: "get", mutating: false, confirmation: false, perms: [] as string[] }],
      ["generate_lesson_content", { domain: "courses", resource: "lesson", operation: "generate", mutating: true, confirmation: true, perms: ["course.manage"] }],
      ["generate_assessment", { domain: "courses", resource: "assessment", operation: "generate", mutating: true, confirmation: true, perms: ["course.manage"] }],
    ] as const) {
      const tool = byName.get(name);
      expect(tool, `${name} should be registered`).toBeDefined();
      expect(tool!.domain).toBe(expected.domain);
      expect(tool!.resource).toBe(expected.resource);
      expect(tool!.operation).toBe(expected.operation);
      expect(describeToolForProvider(tool!)).toMatch(new RegExp(`^\\[${expected.domain} → ${expected.resource}\\.${expected.operation}\\]`));
      expect(tool!.mutating).toBe(expected.mutating);
      expect(tool!.requiresConfirmation).toBe(expected.confirmation);
      expect(tool!.requiredPermissions).toEqual(expected.perms);
    }
  });
});

describe("Lesson Content AI — schema validation rejects malformed input before any proposal exists", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("generate_lesson_content: exactly one content field is required", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    await expect(propose(tenantId, userId, "generate_lesson_content", { lessonId: randomUUID(), lessonTitle: "L" }, conversationId)).rejects.toBeInstanceOf(ToolInputInvalidError);
    await expect(
      propose(tenantId, userId, "generate_lesson_content", { lessonId: randomUUID(), lessonTitle: "L", articleBody: "A", videoScript: "B" }, conversationId),
    ).rejects.toBeInstanceOf(ToolInputInvalidError);
  });

  it("generate_assessment: moduleId is required (it can only create a new assessment)", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    const q = [{ type: "true_false", text: "Q?", correctAnswer: "true" }];
    await expect(propose(tenantId, userId, "generate_assessment", { title: "X", assessmentType: "test", questions: q }, conversationId)).rejects.toBeInstanceOf(ToolInputInvalidError);
    // moduleId is still required even if a (now-unrecognized, silently-stripped) lessonId is also
    // given — lessonId was removed entirely from this schema this phase (see Assessment Refinement
    // AI phase's doc comment on generate_assessment; update_assessment is the tool for that now).
    await expect(
      propose(tenantId, userId, "generate_assessment", { lessonId: randomUUID(), title: "X", assessmentType: "test", questions: q }, conversationId),
    ).rejects.toBeInstanceOf(ToolInputInvalidError);
  });

  it("generate_assessment: creating new requires assessmentType", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    await expect(
      propose(tenantId, userId, "generate_assessment", { moduleId: randomUUID(), title: "Quiz", questions: [{ type: "true_false", text: "Q?", correctAnswer: "true" }] }, conversationId),
    ).rejects.toBeInstanceOf(ToolInputInvalidError);
  });

  it("generate_assessment: rejects a multiple_choice question with fewer than 2 choices", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    await expect(
      propose(
        tenantId,
        userId,
        "generate_assessment",
        { moduleId: randomUUID(), title: "Quiz", assessmentType: "test", questions: [{ type: "multiple_choice", text: "Q?", choices: ["A"], correctAnswer: "A" }] },
        conversationId,
      ),
    ).rejects.toBeInstanceOf(ToolInputInvalidError);
  });

  it("generate_assessment: rejects a correctAnswer that doesn't match any choice", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    await expect(
      propose(
        tenantId,
        userId,
        "generate_assessment",
        { moduleId: randomUUID(), title: "Quiz", assessmentType: "test", questions: [{ type: "multiple_choice", text: "Q?", choices: ["A", "B"], correctAnswer: "C" }] },
        conversationId,
      ),
    ).rejects.toBeInstanceOf(ToolInputInvalidError);
  });

  it("generate_assessment: rejects a true_false question whose correctAnswer isn't exactly true/false", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    await expect(
      propose(tenantId, userId, "generate_assessment", { moduleId: randomUUID(), title: "Quiz", assessmentType: "test", questions: [{ type: "true_false", text: "Q?", correctAnswer: "yes" }] }, conversationId),
    ).rejects.toBeInstanceOf(ToolInputInvalidError);
  });
});

describe("Lesson Content AI — get_course_lesson_content", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns the full payload, including body, not just metadata", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, { title: "Phishing Basics", payload: { body: "real content here" } });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const result = await propose(tenantId, userId, "get_course_lesson_content", { lessonId }, conversationId);
      expect(result.status).toBe("executed");
      const data = result.output as { title: string; payload: { body: string } };
      expect(data.title).toBe("Phishing Basics");
      expect(data.payload.body).toBe("real content here");
    } finally {
      await server.close();
    }
  });

  it("requires no permission — same read-tool precedent as list_course_lessons", async () => {
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

      // A course with no assignment configuration at all is visible to everyone (existing,
      // pre-established backward-compatibility rule — same as `list_course_modules`/`list_courses`),
      // so this succeeds even for a permission-less caller — the point being proven is that it
      // succeeds AT ALL (no ToolPermissionDeniedError), confirming requiredPermissions: [] really is
      // enforced as "any authenticated session," not silently gated some other way.
      const result = await propose(tenantId, noPermId, "get_course_lesson_content", { lessonId }, conversationId);
      expect(result.status).toBe("executed");
    } finally {
      await server.close();
    }
  });
});

describe("Lesson Content AI — generate_lesson_content behavior and content-type safety", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("article: replaces payload.body, preserves nothing fabricated", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, { title: "Phishing Basics", payload: { body: "placeholder" } });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "generate_lesson_content", { lessonId, lessonTitle: "Phishing Basics", articleBody: "# Real Content\nThis is the generated body." }, conversationId);
      expect(proposal.status).toBe("pending_confirmation");
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const [lesson] = await readLesson(tenantId, lessonId);
      expect((lesson.payload as { body: string }).body).toBe("# Real Content\nThis is the generated body.");
      expect(lesson.type).toBe("article"); // immutable, untouched
    } finally {
      await server.close();
    }
  });

  it("video WITH an existing url: adds payload.script, preserves the existing url untouched", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, { type: "video", title: "Intro Video", payload: { url: "https://videos.example.com/real-video.mp4" } });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "generate_lesson_content", { lessonId, lessonTitle: "Intro Video", videoScript: "Scene 1: Welcome..." }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const [lesson] = await readLesson(tenantId, lessonId);
      const payload = lesson.payload as { url: string; script: string };
      expect(payload.script).toBe("Scene 1: Welcome...");
      expect(payload.url).toBe("https://videos.example.com/real-video.mp4"); // never touched, never fabricated
    } finally {
      await server.close();
    }
  });

  it("video WITHOUT a url: confirmation fails cleanly, no url is fabricated, lesson unchanged", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      // A video lesson literally cannot be created without a url via the real route (payload
      // validation requires it) — simulate the edge case directly at the DB level to prove the AI
      // tool's own defensive check, independent of route-level validation.
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, { type: "video", title: "Broken Video", payload: { url: "https://videos.example.com/x.mp4" } });
      await withTenantDb(tenantId, (db) => db.update(contentItems).set({ payload: {} }).where(eq(contentItems.id, lessonId)));
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "generate_lesson_content", { lessonId, lessonTitle: "Broken Video", videoScript: "Scene 1..." }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("failed");
      expect(confirmed.error).toMatch(/no video url yet/i);

      const [lesson] = await readLesson(tenantId, lessonId);
      expect(lesson.payload).toEqual({}); // unchanged, no fabricated url
    } finally {
      await server.close();
    }
  });

  it("live_class WITHOUT a scheduledAt: confirmation fails cleanly, nothing fabricated", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, { type: "live_class", title: "Live Session", payload: { scheduledAt: "2026-01-01T10:00:00Z" } });
      await withTenantDb(tenantId, (db) => db.update(contentItems).set({ payload: {} }).where(eq(contentItems.id, lessonId)));
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "generate_lesson_content", { lessonId, lessonTitle: "Live Session", liveClassAgenda: "1. Welcome\n2. Q&A" }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("failed");
      expect(confirmed.error).toMatch(/no scheduled date yet/i);

      const [lesson] = await readLesson(tenantId, lessonId);
      expect(lesson.payload).toEqual({});
    } finally {
      await server.close();
    }
  });

  it("wrong content field for the lesson's actual type: confirmation fails cleanly, lesson unchanged", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, { type: "video", title: "A Video", payload: { url: "https://videos.example.com/x.mp4" } });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      // articleBody given, but the lesson is actually type "video".
      const proposal = await propose(tenantId, userId, "generate_lesson_content", { lessonId, lessonTitle: "A Video", articleBody: "Wrong field for this type" }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("failed");
      expect(confirmed.error).toMatch(/is a video/i);

      const [lesson] = await readLesson(tenantId, lessonId);
      expect(lesson.payload).toEqual({ url: "https://videos.example.com/x.mp4" }); // untouched
    } finally {
      await server.close();
    }
  });

  it("a test/assignment lesson: generate_lesson_content refuses it, directing to generate_assessment", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, { type: "test", title: "A Quiz", payload: {} });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "generate_lesson_content", { lessonId, lessonTitle: "A Quiz", articleBody: "Not applicable" }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("failed");
      expect(confirmed.error).toMatch(/generate_assessment/i);
    } finally {
      await server.close();
    }
  });
});

describe("Lesson Content AI — generate_assessment behavior", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("creates a new test lesson with the generated questions", async () => {
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

      const questions = [
        { type: "multiple_choice", text: "What is phishing?", choices: ["A scam", "A fish", "A game"], correctAnswer: "A scam", explanation: "Phishing is a social engineering attack." },
        { type: "true_false", text: "You should click unknown links.", correctAnswer: "false" },
      ];
      const proposal = await propose(tenantId, userId, "generate_assessment", { moduleId, title: "Phishing Quiz", assessmentType: "test", questions }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const output = confirmed.output as { id: string; type: string; title: string };
      const [lesson] = await readLesson(tenantId, output.id);
      expect(lesson.type).toBe("test");
      expect(lesson.title).toBe("Phishing Quiz");
      expect((lesson.payload as { questions: unknown[] }).questions).toHaveLength(2);
      expect(lesson.status).toBe("draft"); // whatever the existing default already is
    } finally {
      await server.close();
    }
  });

  // Regenerating/modifying an EXISTING assessment (previously exercised here via a now-removed
  // generate_assessment `lessonId` path) moved to `update_assessment`'s own tests — see
  // ai-foundation-assessment-editing.test.ts (Assessment Refinement AI phase).
});

describe("Lesson Content AI — security", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("tenant isolation: Tenant B cannot generate content for or read Tenant A's lesson", async () => {
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
      const moduleId = await createTestModule(tenantAId, userAId, courseId, server);
      const lessonId = await createTestLesson(tenantAId, userAId, moduleId, server, { title: "Tenant A Lesson" });

      const conversationId = randomUUID();
      await seedConversation(tenantBId, userBId, conversationId);

      const readAttempt = await propose(tenantBId, userBId, "get_course_lesson_content", { lessonId }, conversationId);
      expect(readAttempt.status).toBe("failed");
      expect(readAttempt.error).toMatch(/not found/i);

      const generateAttempt = await propose(tenantBId, userBId, "generate_lesson_content", { lessonId, lessonTitle: "Hacked", articleBody: "Hacked content" }, conversationId);
      const generateConfirm = await confirm(tenantBId, userBId, generateAttempt.executionId);
      expect(generateConfirm.status).toBe("failed");

      const [lesson] = await readLesson(tenantAId, lessonId);
      expect(lesson.title).toBe("Tenant A Lesson");
      expect((lesson.payload as { body: string }).body).toBe("original body");
    } finally {
      await server.close();
    }
  });

  it("permission enforcement: a user without course.manage cannot propose generate_lesson_content or generate_assessment", async () => {
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

      await expect(propose(tenantId, noPermId, "generate_lesson_content", { lessonId, lessonTitle: "L", articleBody: "X" }, conversationId)).rejects.toBeInstanceOf(ToolPermissionDeniedError);
      await expect(
        propose(tenantId, noPermId, "generate_assessment", { moduleId, title: "Q", assessmentType: "test", questions: [{ type: "true_false", text: "Q?", correctAnswer: "true" }] }, conversationId),
      ).rejects.toBeInstanceOf(ToolPermissionDeniedError);
    } finally {
      await server.close();
    }
  });

  it("tenant-ID injection: a fabricated tenantId is ignored", async () => {
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
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, { title: "Real Lesson" });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "generate_lesson_content", { lessonId, lessonTitle: "Real Lesson", articleBody: "New content", tenantId: otherTenantId, isSuperAdmin: true }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const [lesson] = await readLesson(tenantId, lessonId);
      expect(lesson.tenantId).toBe(tenantId);
      expect((lesson.payload as { body: string }).body).toBe("New content");
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
        payload: { content: "Generate content for this lesson.", context: { courseId: randomUUID(), tenantId: randomUUID(), isSuperAdmin: true } },
      });
      expect(res.statusCode).toBe(503);
    } finally {
      await server.close();
    }
  });

  it("proposal before write: neither generate_lesson_content nor generate_assessment mutate the database at propose time", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server);
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const p1 = await propose(tenantId, userId, "generate_lesson_content", { lessonId, lessonTitle: "Lesson", articleBody: "Should not apply yet" }, conversationId);
      const p2 = await propose(tenantId, userId, "generate_assessment", { moduleId, title: "New Quiz", assessmentType: "test", questions: [{ type: "true_false", text: "Q?", correctAnswer: "true" }] }, conversationId);
      expect([p1.status, p2.status]).toEqual(["pending_confirmation", "pending_confirmation"]);

      const [lesson] = await readLesson(tenantId, lessonId);
      expect((lesson.payload as { body: string }).body).toBe("original body");
      const [newQuiz] = await withTenantDb(tenantId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.title, "New Quiz")));
      expect(newQuiz).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("duplicate confirmation fails safely", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server);
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "generate_lesson_content", { lessonId, lessonTitle: "Lesson", articleBody: "Content" }, conversationId);
      const first = await confirm(tenantId, userId, proposal.executionId);
      expect(first.status).toBe("executed");
      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolAlreadyResolvedError);
    } finally {
      await server.close();
    }
  });

  it("an expired proposal cannot execute", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server);
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "generate_lesson_content", { lessonId, lessonTitle: "Lesson", articleBody: "Content" }, conversationId);
      await withTenantDb(tenantId, (db) => db.update(aiToolExecutions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(aiToolExecutions.id, proposal.executionId)));

      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolExpiredError);
      const [lesson] = await readLesson(tenantId, lessonId);
      expect((lesson.payload as { body: string }).body).toBe("original body");
    } finally {
      await server.close();
    }
  });

  it("permission revoked between propose and confirm blocks execution", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    const { roleId } = await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server);
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "generate_lesson_content", { lessonId, lessonTitle: "Lesson", articleBody: "Content" }, conversationId);
      await withTenantDb(tenantId, (db) => db.execute(`DELETE FROM user_roles WHERE user_id = '${userId}' AND role_id = '${roleId}'`));

      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolPermissionDeniedError);
      const [lesson] = await readLesson(tenantId, lessonId);
      expect((lesson.payload as { body: string }).body).toBe("original body");
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
      expect(await withTenantDb(tenantBId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.id, lessonId)))).toHaveLength(0);
    } finally {
      await server.close();
    }
  });
});
