import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { withTenantDb, closeTestPool } from "../helpers/pg";
import type { Db } from "../../src/db/client";
import { contentItems } from "../../src/db/schema/course-content";
import { aiConversations, aiToolExecutions } from "../../src/db/schema/ai";
import { invokeTool, confirmToolExecution, rejectToolExecution, ToolPermissionDeniedError, ToolAlreadyResolvedError, ToolExpiredError, ToolInputInvalidError, type ToolInvocationResult } from "../../src/ai/execution-state-machine";
import { listTools, describeToolForProvider } from "../../src/ai/tool-registry";
import "../../src/ai/tools";
import type { ToolContext } from "../../src/ai/types";

/**
 * AI Assessment Refinement & Editing phase — `update_assessment`, the tool that modifies an
 * EXISTING test/assignment lesson's questions (added this phase to fix the ambiguity where
 * `generate_assessment`'s old optional `lessonId` path let the model pick "create a new assessment"
 * for a request that clearly meant "modify the existing one" — see `ai/tools/courses.ts`'s doc
 * comment on both tools). Reuses the exact same test-server/fixture/propose-confirm helpers every
 * other Courses-domain integration test file in this session already established.
 */

async function createTestCourse(tenantId: string, userId: string, server: Awaited<ReturnType<typeof buildTestServer>>, overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: "/tenant/courses",
    headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
    payload: { title: `Test Course ${randomUUID().slice(0, 8)}`, category: "Assessment Editing Tests", deliveryMode: "self_paced", duration: { value: 1, unit: "hours" }, ...overrides },
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
    payload: { type: "test", title: "Quiz", payload: {}, ...overrides },
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

function reject(tenantId: string, userId: string, executionId: string) {
  return runInOwnTransaction(tenantId, userId, (ctx) => rejectToolExecution(executionId, ctx));
}

function readLesson(tenantId: string, lessonId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.id, lessonId)));
}

const q = (text: string, correctAnswer = "true") => ({ type: "true_false" as const, text, correctAnswer });

describe("Assessment Editing AI — tool registration", () => {
  it("update_assessment is tagged as a distinct operation from generate_assessment", () => {
    const byName = new Map(listTools().map((t) => [t.name, t]));
    const update = byName.get("update_assessment");
    expect(update, "update_assessment should be registered").toBeDefined();
    expect(update!.domain).toBe("courses");
    expect(update!.resource).toBe("assessment");
    expect(update!.operation).toBe("update");
    expect(describeToolForProvider(update!)).toMatch(/^\[courses → assessment\.update\]/);
    expect(update!.mutating).toBe(true);
    expect(update!.requiresConfirmation).toBe(true);
    expect(update!.requiredPermissions).toEqual(["course.manage"]);

    const generate = byName.get("generate_assessment");
    expect(generate!.operation).toBe("generate");
    // Different `operation` tags on the same domain+resource is exactly the disambiguation signal
    // the model relies on (`ai/routes.ts`'s SYSTEM_PROMPT tool-selection-discipline paragraph).
    expect(update!.operation).not.toBe(generate!.operation);
  });
});

describe("Assessment Editing AI — schema validation rejects malformed input before any proposal exists", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  async function setup() {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);
    return { tenantId, userId, conversationId };
  }

  it("requires currentQuestions (even an empty array) — cannot be omitted", async () => {
    const { tenantId, userId, conversationId } = await setup();
    await expect(
      propose(tenantId, userId, "update_assessment", { lessonId: randomUUID(), title: "Q", questions: [q("Q1")] }, conversationId),
    ).rejects.toBeInstanceOf(ToolInputInvalidError);
  });

  it("requires at least one proposed question", async () => {
    const { tenantId, userId, conversationId } = await setup();
    await expect(
      propose(tenantId, userId, "update_assessment", { lessonId: randomUUID(), title: "Q", currentQuestions: [], questions: [] }, conversationId),
    ).rejects.toBeInstanceOf(ToolInputInvalidError);
  });

  it("rejects a multiple_choice question with fewer than 2 choices", async () => {
    const { tenantId, userId, conversationId } = await setup();
    await expect(
      propose(
        tenantId,
        userId,
        "update_assessment",
        { lessonId: randomUUID(), title: "Q", currentQuestions: [], questions: [{ type: "multiple_choice", text: "Q?", choices: ["A"], correctAnswer: "A" }] },
        conversationId,
      ),
    ).rejects.toBeInstanceOf(ToolInputInvalidError);
  });

  it("rejects a correctAnswer that doesn't match any choice", async () => {
    const { tenantId, userId, conversationId } = await setup();
    await expect(
      propose(
        tenantId,
        userId,
        "update_assessment",
        { lessonId: randomUUID(), title: "Q", currentQuestions: [], questions: [{ type: "multiple_choice", text: "Q?", choices: ["A", "B"], correctAnswer: "C" }] },
        conversationId,
      ),
    ).rejects.toBeInstanceOf(ToolInputInvalidError);
  });

  it("rejects a true_false question whose correctAnswer isn't exactly true/false", async () => {
    const { tenantId, userId, conversationId } = await setup();
    await expect(
      propose(tenantId, userId, "update_assessment", { lessonId: randomUUID(), title: "Q", currentQuestions: [], questions: [{ type: "true_false", text: "Q?", correctAnswer: "yes" }] }, conversationId),
    ).rejects.toBeInstanceOf(ToolInputInvalidError);
  });

  it("rejects an invalid question type", async () => {
    const { tenantId, userId, conversationId } = await setup();
    await expect(
      propose(tenantId, userId, "update_assessment", { lessonId: randomUUID(), title: "Q", currentQuestions: [], questions: [{ type: "essay", text: "Q?", correctAnswer: "A" }] }, conversationId),
    ).rejects.toBeInstanceOf(ToolInputInvalidError);
  });

  it("rejects more than 30 questions", async () => {
    const { tenantId, userId, conversationId } = await setup();
    const tooMany = Array.from({ length: 31 }, (_, i) => q(`Q${i}`));
    await expect(propose(tenantId, userId, "update_assessment", { lessonId: randomUUID(), title: "Q", currentQuestions: [], questions: tooMany }, conversationId)).rejects.toBeInstanceOf(
      ToolInputInvalidError,
    );
  });

  it("generate_assessment no longer accepts a lessonId-based regenerate path (narrowed this phase)", async () => {
    const { tenantId, userId, conversationId } = await setup();
    // moduleId is required and absent here — this must fail regardless of the (now-ignored) lessonId.
    await expect(
      propose(tenantId, userId, "generate_assessment", { lessonId: randomUUID(), title: "Q", assessmentType: "test", questions: [q("Q1")] }, conversationId),
    ).rejects.toBeInstanceOf(ToolInputInvalidError);
  });
});

describe("Assessment Editing AI — update_assessment behavior", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("regenerating replaces the question set entirely, never merges", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const currentQuestions = [{ type: "true_false", text: "Old question", correctAnswer: "true" }];
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, { title: "Old Quiz", payload: { questions: currentQuestions } });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const newQuestions = [q("New question 1"), q("New question 2", "false")];
      const proposal = await propose(tenantId, userId, "update_assessment", { lessonId, title: "Old Quiz", currentQuestions, questions: newQuestions }, conversationId);
      expect(proposal.status).toBe("pending_confirmation");
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const [lesson] = await readLesson(tenantId, lessonId);
      const questions = (lesson.payload as { questions: { text: string }[] }).questions;
      expect(questions).toHaveLength(2);
      expect(questions.map((qq) => qq.text)).toEqual(["New question 1", "New question 2"]);
      expect(questions.some((qq) => qq.text === "Old question")).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("adding questions: proposed set is a superset of currentQuestions plus the new ones", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const currentQuestions = [q("Q1"), q("Q2")];
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, { title: "Quiz", payload: { questions: currentQuestions } });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposed = [...currentQuestions, q("Q3"), q("Q4")];
      const proposal = await propose(tenantId, userId, "update_assessment", { lessonId, title: "Quiz", currentQuestions, questions: proposed }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const [lesson] = await readLesson(tenantId, lessonId);
      expect((lesson.payload as { questions: unknown[] }).questions).toHaveLength(4);
    } finally {
      await server.close();
    }
  });

  it("removing a question: proposed set omits it, everything else preserved", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const currentQuestions = [q("Q1"), q("Q2"), q("Q3")];
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, { title: "Quiz", payload: { questions: currentQuestions } });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposed = [currentQuestions[0], currentQuestions[2]]; // remove Q2
      const proposal = await propose(tenantId, userId, "update_assessment", { lessonId, title: "Quiz", currentQuestions, questions: proposed }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const [lesson] = await readLesson(tenantId, lessonId);
      const questions = (lesson.payload as { questions: { text: string }[] }).questions;
      expect(questions.map((qq) => qq.text)).toEqual(["Q1", "Q3"]);
    } finally {
      await server.close();
    }
  });

  it("first-time population: an existing test/assignment lesson with no questions yet (payload {}) accepts currentQuestions: []", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, { title: "Blank Quiz", payload: {} });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "update_assessment", { lessonId, title: "Blank Quiz", currentQuestions: [], questions: [q("Q1")] }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const [lesson] = await readLesson(tenantId, lessonId);
      expect((lesson.payload as { questions: unknown[] }).questions).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("staleness: if the assessment changed since currentQuestions was captured, confirmation fails safely and writes nothing", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const originalQuestions = [q("Q1"), q("Q2")];
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, { title: "Quiz", payload: { questions: originalQuestions } });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      // Model reads the assessment, proposes a change based on that snapshot...
      const proposal = await propose(
        tenantId,
        userId,
        "update_assessment",
        { lessonId, title: "Quiz", currentQuestions: originalQuestions, questions: [...originalQuestions, q("Q3")] },
        conversationId,
      );
      expect(proposal.status).toBe("pending_confirmation");

      // ...but someone else changes the real assessment first (e.g. through the manual editor).
      await withTenantDb(tenantId, (db) => db.update(contentItems).set({ payload: { questions: [q("Someone else's edit")] } }).where(eq(contentItems.id, lessonId)));

      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("failed");
      expect(confirmed.error).toMatch(/changed since this proposal was created/i);

      const [lesson] = await readLesson(tenantId, lessonId);
      const questions = (lesson.payload as { questions: { text: string }[] }).questions;
      // The intervening edit survives untouched — the stale proposal never overwrote it.
      expect(questions.map((qq) => qq.text)).toEqual(["Someone else's edit"]);
    } finally {
      await server.close();
    }
  });

  it("updating a non-test/assignment lesson fails cleanly", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, { type: "article", title: "An Article", payload: { body: "text" } });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "update_assessment", { lessonId, title: "An Article", currentQuestions: [], questions: [q("Q1")] }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("failed");
      expect(confirmed.error).toMatch(/not a test\/assignment/i);
    } finally {
      await server.close();
    }
  });

  it("never changes the lesson's type, module, or course", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const currentQuestions = [q("Q1")];
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, { type: "assignment", title: "Assignment Quiz", payload: { questions: currentQuestions } });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "update_assessment", { lessonId, title: "Assignment Quiz", currentQuestions, questions: [q("Q1 revised")] }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const [lesson] = await readLesson(tenantId, lessonId);
      expect(lesson.type).toBe("assignment"); // immutable, untouched
      expect(lesson.moduleId).toBe(moduleId);
      expect(lesson.courseId).toBe(courseId);
    } finally {
      await server.close();
    }
  });
});

describe("Assessment Editing AI — security", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("tenant isolation: Tenant B cannot update or read Tenant A's assessment", async () => {
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
      const currentQuestions = [q("Real question")];
      const lessonId = await createTestLesson(tenantAId, userAId, moduleId, server, { title: "Tenant A Quiz", payload: { questions: currentQuestions } });

      const conversationId = randomUUID();
      await seedConversation(tenantBId, userBId, conversationId);

      const readAttempt = await propose(tenantBId, userBId, "get_course_lesson_content", { lessonId }, conversationId);
      expect(readAttempt.status).toBe("failed");
      expect(readAttempt.error).toMatch(/not found/i);

      const updateAttempt = await propose(tenantBId, userBId, "update_assessment", { lessonId, title: "Hacked", currentQuestions: [], questions: [q("Hacked question")] }, conversationId);
      const updateConfirm = await confirm(tenantBId, userBId, updateAttempt.executionId);
      expect(updateConfirm.status).toBe("failed");

      const [lesson] = await readLesson(tenantAId, lessonId);
      expect((lesson.payload as { questions: { text: string }[] }).questions[0].text).toBe("Real question");
    } finally {
      await server.close();
    }
  });

  it("cross-course/module: a lessonId always resolves to its OWN course/module server-side — there is no field to redirect the write elsewhere", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseAId = await createTestCourse(tenantId, userId, server);
      const moduleAId = await createTestModule(tenantId, userId, courseAId, server, "Module A");
      const currentQuestions = [q("Q1")];
      const lessonId = await createTestLesson(tenantId, userId, moduleAId, server, { title: "Quiz A", payload: { questions: currentQuestions } });

      const courseBId = await createTestCourse(tenantId, userId, server);
      const moduleBId = await createTestModule(tenantId, userId, courseBId, server, "Module B");

      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      // update_assessment's schema has no moduleId/courseId field at all — passing one is simply
      // ignored by Zod (stripped as an unrecognized key), never used to redirect the write.
      const proposal = await propose(
        tenantId,
        userId,
        "update_assessment",
        { lessonId, title: "Quiz A", currentQuestions, questions: [q("Q1 revised")], moduleId: moduleBId, courseId: courseBId },
        conversationId,
      );
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const [lesson] = await readLesson(tenantId, lessonId);
      expect(lesson.moduleId).toBe(moduleAId);
      expect(lesson.courseId).toBe(courseAId);
    } finally {
      await server.close();
    }
  });

  it("permission enforcement: a user without course.manage cannot propose update_assessment", async () => {
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
      const lessonId = await createTestLesson(tenantId, adminId, moduleId, server, { payload: { questions: [q("Q1")] } });
      const conversationId = randomUUID();
      await seedConversation(tenantId, noPermId, conversationId);

      await expect(
        propose(tenantId, noPermId, "update_assessment", { lessonId, title: "Q", currentQuestions: [q("Q1")], questions: [q("Q1 revised")] }, conversationId),
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
      const currentQuestions = [q("Q1")];
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, { title: "Real Quiz", payload: { questions: currentQuestions } });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(
        tenantId,
        userId,
        "update_assessment",
        { lessonId, title: "Real Quiz", currentQuestions, questions: [q("Q1 revised")], tenantId: otherTenantId, isSuperAdmin: true },
        conversationId,
      );
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const [lesson] = await readLesson(tenantId, lessonId);
      expect(lesson.tenantId).toBe(tenantId);
    } finally {
      await server.close();
    }
  });

  it("proposal before write: update_assessment does not mutate the database at propose time", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const currentQuestions = [q("Q1")];
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, { title: "Quiz", payload: { questions: currentQuestions } });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "update_assessment", { lessonId, title: "Quiz", currentQuestions, questions: [q("Q1 revised")] }, conversationId);
      expect(proposal.status).toBe("pending_confirmation");

      const [lesson] = await readLesson(tenantId, lessonId);
      expect((lesson.payload as { questions: { text: string }[] }).questions[0].text).toBe("Q1");
    } finally {
      await server.close();
    }
  });

  it("rejected proposal: the assessment is left completely unchanged", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server);
      const currentQuestions = [q("Q1")];
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, { title: "Quiz", payload: { questions: currentQuestions } });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "update_assessment", { lessonId, title: "Quiz", currentQuestions, questions: [q("Q1 revised")] }, conversationId);
      const rejected = await reject(tenantId, userId, proposal.executionId);
      expect(rejected.status).toBe("rejected");

      const [lesson] = await readLesson(tenantId, lessonId);
      expect((lesson.payload as { questions: { text: string }[] }).questions[0].text).toBe("Q1");

      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolAlreadyResolvedError);
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
      const currentQuestions = [q("Q1")];
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, { title: "Quiz", payload: { questions: currentQuestions } });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "update_assessment", { lessonId, title: "Quiz", currentQuestions, questions: [q("Q1 revised")] }, conversationId);
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
      const currentQuestions = [q("Q1")];
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, { title: "Quiz", payload: { questions: currentQuestions } });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "update_assessment", { lessonId, title: "Quiz", currentQuestions, questions: [q("Q1 revised")] }, conversationId);
      await withTenantDb(tenantId, (db) => db.update(aiToolExecutions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(aiToolExecutions.id, proposal.executionId)));

      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolExpiredError);
      const [lesson] = await readLesson(tenantId, lessonId);
      expect((lesson.payload as { questions: { text: string }[] }).questions[0].text).toBe("Q1");
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
      const currentQuestions = [q("Q1")];
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, { title: "Quiz", payload: { questions: currentQuestions } });
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "update_assessment", { lessonId, title: "Quiz", currentQuestions, questions: [q("Q1 revised")] }, conversationId);
      await withTenantDb(tenantId, (db) => db.execute(`DELETE FROM user_roles WHERE user_id = '${userId}' AND role_id = '${roleId}'`));

      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolPermissionDeniedError);
      const [lesson] = await readLesson(tenantId, lessonId);
      expect((lesson.payload as { questions: { text: string }[] }).questions[0].text).toBe("Q1");
    } finally {
      await server.close();
    }
  });
});
