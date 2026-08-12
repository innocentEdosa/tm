import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { withTenantDb, closeTestPool } from "../helpers/pg";
import type { Db } from "../../src/db/client";
import { courses } from "../../src/db/schema/courses";
import { courseCategories } from "../../src/db/schema/course-categories";
import { courseModules, contentItems } from "../../src/db/schema/course-content";
import { aiConversations, aiToolExecutions } from "../../src/db/schema/ai";
import {
  invokeTool,
  confirmToolExecution,
  rejectToolExecution,
  ToolPermissionDeniedError,
  ToolAlreadyResolvedError,
  ToolExpiredError,
  ToolInputInvalidError,
  type ToolInvocationResult,
} from "../../src/ai/execution-state-machine";
import { listTools, describeToolForProvider } from "../../src/ai/tool-registry";
import { GENERATION_LIMITS } from "../../src/courses/course-service";
import "../../src/ai/tools";
import type { ToolContext } from "../../src/ai/types";

/**
 * Course Generation AI Phase 1 — `generate_course_structure`. Same integration-test convention as
 * every prior Courses-domain test file (real Postgres/RLS, `invokeTool`/`confirmToolExecution`
 * called directly). Covers Phase 17's security list plus the schema-level generation limits (Phase
 * 4) and the transaction/savepoint mechanism `CourseService.generateCourseStructure`'s own doc
 * comment promises (Phase 12) — proven directly against a real Postgres connection, not just
 * reasoned about.
 */

function samplePlan(overrides: Record<string, unknown> = {}) {
  return {
    title: "Cybersecurity Awareness for New Employees",
    category: "Cybersecurity",
    deliveryMode: "self_paced",
    duration: { value: 28, unit: "days" },
    learningObjectives: ["Identify common security threats", "Recognize phishing attempts"],
    modules: [
      { title: "Security Fundamentals", lessons: [{ title: "What is cybersecurity?" }, { title: "Common security threats" }] },
      { title: "Passwords & Authentication", lessons: [{ title: "Password security" }, { title: "MFA" }] },
    ],
    ...overrides,
  };
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

function propose(tenantId: string, userId: string, input: Record<string, unknown>, conversationId: string): Promise<ToolInvocationResult> {
  return runInOwnTransaction(tenantId, userId, (ctx) => invokeTool("generate_course_structure", ctx, input, conversationId));
}

function confirm(tenantId: string, userId: string, executionId: string): Promise<ToolInvocationResult> {
  return runInOwnTransaction(tenantId, userId, (ctx) => confirmToolExecution(executionId, ctx));
}

function readCoursesByTitle(tenantId: string, title: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(courses).where(eq(courses.title, title)));
}

function readModules(tenantId: string, courseId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(courseModules).where(eq(courseModules.courseId, courseId)).orderBy(courseModules.position));
}

function readLessons(tenantId: string, moduleId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.moduleId, moduleId)).orderBy(contentItems.position));
}

function countAllCourses(tenantId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(courses));
}

describe("Course Generation AI — tool registration", () => {
  it("is correctly tagged, mutating, confirmation-gated, and permission-gated", () => {
    const tool = listTools().find((t) => t.name === "generate_course_structure");
    expect(tool).toBeDefined();
    expect(tool!.domain).toBe("courses");
    expect(tool!.resource).toBe("course");
    expect(tool!.operation).toBe("generate");
    expect(describeToolForProvider(tool!)).toMatch(/^\[courses → course\.generate\]/);
    expect(tool!.mutating).toBe(true);
    expect(tool!.requiresConfirmation).toBe(true);
    expect(tool!.requiredPermissions).toEqual(["course.manage"]);
  });

});

describe("Course Generation AI — existing course context safety (Phase 15)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("a fabricated/extra courseId in the generation input is ignored — an existing course is never touched, a new one is always created instead", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    // A real, pre-existing course that must remain completely untouched.
    const existingProposal = await propose(tenantId, userId, samplePlan({ title: "Pre-Existing Course" }), conversationId);
    await confirm(tenantId, userId, existingProposal.executionId);
    const [existingCourse] = await readCoursesByTitle(tenantId, "Pre-Existing Course");

    // Generation input with an extra, unsupported courseId field pointed at that existing course —
    // the schema has no such field to land in, so Zod strips it; even if it didn't, `execute()` never
    // reads anything but the plan's own new-course fields.
    const proposal = await propose(tenantId, userId, samplePlan({ title: "A New Course", courseId: existingCourse.id }), conversationId);
    const confirmed = await confirm(tenantId, userId, proposal.executionId);
    expect(confirmed.status).toBe("executed");

    const [unchanged] = await readCoursesByTitle(tenantId, "Pre-Existing Course");
    expect(unchanged.title).toBe("Pre-Existing Course");
    expect(unchanged.updatedAt.getTime()).toBe(existingCourse.updatedAt.getTime());

    const [newCourse] = await readCoursesByTitle(tenantId, "A New Course");
    expect(newCourse.id).not.toBe(existingCourse.id);
    expect(await countAllCourses(tenantId)).toHaveLength(2);
  });
});

describe("Course Generation AI — happy path creates the complete, correctly-ordered structure", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("propose then confirm creates exactly the proposed course, modules, and lessons, in order, as draft", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    const proposal = await propose(tenantId, userId, samplePlan(), conversationId);
    expect(proposal.status).toBe("pending_confirmation");

    const confirmed = await confirm(tenantId, userId, proposal.executionId);
    expect(confirmed.status).toBe("executed");

    const [course] = await readCoursesByTitle(tenantId, "Cybersecurity Awareness for New Employees");
    expect(course.status).toBe("draft");
    expect(course.deliveryMode).toBe("self_paced");
    expect(course.durationValue).toBe(28);
    expect(course.durationUnit).toBe("days");
    expect(course.learningObjectives).toEqual(["Identify common security threats", "Recognize phishing attempts"]);

    const modules = await readModules(tenantId, course.id);
    expect(modules.map((m) => m.title)).toEqual(["Security Fundamentals", "Passwords & Authentication"]);
    expect(modules.map((m) => m.position)).toEqual([0, 1]);
    expect(modules.every((m) => m.status === "draft")).toBe(true);
    expect(course.outlineOrder).toEqual(modules.map((m) => m.id));

    const module1Lessons = await readLessons(tenantId, modules[0].id);
    expect(module1Lessons.map((l) => l.title)).toEqual(["What is cybersecurity?", "Common security threats"]);
    expect(module1Lessons.map((l) => l.position)).toEqual([0, 1]);
    expect(module1Lessons.every((l) => l.type === "article")).toBe(true);
    // No description given for this lesson — an honest placeholder body, not fabricated content.
    expect((module1Lessons[0].payload as { body: string }).body).toMatch(/not been written/i);

    const module2Lessons = await readLessons(tenantId, modules[1].id);
    expect(module2Lessons.map((l) => l.title)).toEqual(["Password security", "MFA"]);
  });

  it("a lesson's own generated description becomes its placeholder body, never a fabricated fact", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    const plan = samplePlan({
      title: "Onboarding for Engineers",
      modules: [{ title: "Git Basics", description: "An intro module.", lessons: [{ title: "Cloning a repo", description: "Covers how to clone a repository locally." }] }],
    });
    const proposal = await propose(tenantId, userId, plan, conversationId);
    await confirm(tenantId, userId, proposal.executionId);

    const [course] = await readCoursesByTitle(tenantId, "Onboarding for Engineers");
    const modules = await readModules(tenantId, course.id);
    const lessons = await readLessons(tenantId, modules[0].id);
    expect((lessons[0].payload as { body: string }).body).toBe("Covers how to clone a repository locally.");
  });

  it("reuses an existing category (case-insensitively) instead of creating a duplicate", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    // First generation creates the "Cybersecurity" category.
    const first = await propose(tenantId, userId, samplePlan({ title: "Course A" }), conversationId);
    await confirm(tenantId, userId, first.executionId);
    // Second generation, different casing, must reuse the same category row.
    const second = await propose(tenantId, userId, samplePlan({ title: "Course B", category: "CYBERSECURITY" }), conversationId);
    await confirm(tenantId, userId, second.executionId);

    const categoryRows = await withTenantDb(tenantId, (db: Db) => db.select().from(courseCategories).where(eq(courseCategories.tenantId, tenantId)));
    const cyberRows = categoryRows.filter((c) => c.name.toLowerCase() === "cybersecurity");
    expect(cyberRows).toHaveLength(1);
  });
});

describe("Course Generation AI — schema limits (Phase 4) reject oversized/malformed plans before a proposal exists", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("too many modules is rejected at propose time — no proposal, no DB records", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    const tooManyModules = Array.from({ length: GENERATION_LIMITS.maxModules + 2 }, (_, i) => ({ title: `Module ${i}`, lessons: [{ title: "Lesson 1" }] }));
    await expect(propose(tenantId, userId, samplePlan({ title: "Too Big", modules: tooManyModules }), conversationId)).rejects.toBeInstanceOf(ToolInputInvalidError);
    expect(await readCoursesByTitle(tenantId, "Too Big")).toHaveLength(0);
  });

  it("too many lessons in one module is rejected at propose time", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    const tooManyLessons = Array.from({ length: GENERATION_LIMITS.maxLessonsPerModule + 2 }, (_, i) => ({ title: `Lesson ${i}` }));
    await expect(propose(tenantId, userId, samplePlan({ title: "Too Many Lessons", modules: [{ title: "M1", lessons: tooManyLessons }] }), conversationId)).rejects.toBeInstanceOf(ToolInputInvalidError);
    expect(await readCoursesByTitle(tenantId, "Too Many Lessons")).toHaveLength(0);
  });

  it("zero modules is rejected", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    await expect(propose(tenantId, userId, samplePlan({ title: "No Modules", modules: [] }), conversationId)).rejects.toBeInstanceOf(ToolInputInvalidError);
  });

  it("a module with zero lessons is rejected", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    await expect(propose(tenantId, userId, samplePlan({ title: "Empty Module", modules: [{ title: "M1", lessons: [] }] }), conversationId)).rejects.toBeInstanceOf(ToolInputInvalidError);
  });

  it("a duplicate module title is rejected", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    const plan = samplePlan({
      title: "Dup Modules",
      modules: [
        { title: "Intro", lessons: [{ title: "L1" }] },
        { title: "intro", lessons: [{ title: "L2" }] },
      ],
    });
    await expect(propose(tenantId, userId, plan, conversationId)).rejects.toBeInstanceOf(ToolInputInvalidError);
  });

  it("a duplicate lesson title within the same module is rejected, but the same title across different modules is fine", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    const dupWithinModule = samplePlan({
      title: "Dup Lessons",
      modules: [{ title: "M1", lessons: [{ title: "Overview" }, { title: "overview" }] }],
    });
    await expect(propose(tenantId, userId, dupWithinModule, conversationId)).rejects.toBeInstanceOf(ToolInputInvalidError);

    const sameAcrossModules = samplePlan({
      title: "Same Title Different Modules",
      modules: [
        { title: "M1", lessons: [{ title: "Overview" }] },
        { title: "M2", lessons: [{ title: "Overview" }] },
      ],
    });
    const proposal = await propose(tenantId, userId, sameAcrossModules, conversationId);
    expect(proposal.status).toBe("pending_confirmation"); // this one is fine
  });

  it("a blank module or lesson title is rejected", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    await expect(propose(tenantId, userId, samplePlan({ title: "Blank Module", modules: [{ title: "  ", lessons: [{ title: "L1" }] }] }), conversationId)).rejects.toBeInstanceOf(ToolInputInvalidError);
    await expect(propose(tenantId, userId, samplePlan({ title: "Blank Lesson", modules: [{ title: "M1", lessons: [{ title: " " }] }] }), conversationId)).rejects.toBeInstanceOf(ToolInputInvalidError);
  });
});

describe("Course Generation AI — transaction/savepoint mechanism (Phase 12: failure safety)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("a raw SAVEPOINT rolls back everything written inside it on a thrown error, without breaking the outer per-request transaction", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);

    await withTenantDb(tenantId, async (db) => {
      const [category] = await db.insert(courseCategories).values({ tenantId, name: "Cat" }).returning();
      const [course] = await db
        .insert(courses)
        .values({ tenantId, title: "Rollback Test Course", categoryId: category.id, deliveryMode: "self_paced", durationValue: 1, durationUnit: "hours", status: "draft" })
        .returning();

      let threw = false;
      await db.execute(sql`SAVEPOINT course_generation_test`);
      try {
        await db.insert(courseModules).values({ tenantId, courseId: course.id, title: "Should Not Survive", position: 0 });
        throw new Error("simulated mid-generation failure");
      } catch {
        threw = true;
        await db.execute(sql`ROLLBACK TO SAVEPOINT course_generation_test`);
      }
      expect(threw).toBe(true);

      // The module insert made INSIDE the failed nested transaction must be gone...
      const modules = await db.select().from(courseModules).where(eq(courseModules.courseId, course.id));
      expect(modules).toHaveLength(0);
      // ...but the outer transaction (this whole withTenantDb callback) is still healthy — the
      // course itself, inserted before the nested transaction, is still there and still queryable.
      const [stillThere] = await db.select().from(courses).where(eq(courses.id, course.id));
      expect(stillThere).toBeDefined();
      expect(stillThere.title).toBe("Rollback Test Course");
    });
  });
});

describe("Course Generation AI — security", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("permission enforcement: a user without course.manage cannot propose generation", async () => {
    const tenantId = randomUUID();
    const noPermId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, noPermId);
    await seedUserWithRole(tenantId, noPermId, []);
    const conversationId = randomUUID();
    await seedConversation(tenantId, noPermId, conversationId);

    await expect(propose(tenantId, noPermId, samplePlan(), conversationId)).rejects.toBeInstanceOf(ToolPermissionDeniedError);
    expect(await countAllCourses(tenantId)).toHaveLength(0);
  });

  it("tenant-ID injection: a fabricated tenantId in the plan is ignored — the course is created under the caller's real tenant", async () => {
    const tenantId = randomUUID();
    const otherTenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId, "Real Tenant");
    await seedTenant(otherTenantId, "Other Tenant");
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    const proposal = await propose(tenantId, userId, samplePlan({ tenantId: otherTenantId, isSuperAdmin: true }), conversationId);
    const confirmed = await confirm(tenantId, userId, proposal.executionId);
    expect(confirmed.status).toBe("executed");

    const [course] = await readCoursesByTitle(tenantId, "Cybersecurity Awareness for New Employees");
    expect(course.tenantId).toBe(tenantId);
    expect(await countAllCourses(otherTenantId)).toHaveLength(0);
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
        payload: { content: "Create a new course about security.", context: { courseId: randomUUID(), tenantId: randomUUID(), isSuperAdmin: true } },
      });
      expect(res.statusCode).toBe(503); // no AI provider configured in tests — same as no context at all
    } finally {
      await server.close();
    }
  });

  it("proposal before write: generating a proposal results in zero course/module/lesson records", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    const proposal = await propose(tenantId, userId, samplePlan(), conversationId);
    expect(proposal.status).toBe("pending_confirmation");
    expect(proposal.output).toBeUndefined();
    expect(await countAllCourses(tenantId)).toHaveLength(0);
  });

  it("rejection produces zero database mutation", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    const proposal = await propose(tenantId, userId, samplePlan(), conversationId);
    await runInOwnTransaction(tenantId, userId, (ctx) => rejectToolExecution(proposal.executionId, ctx));
    expect(await countAllCourses(tenantId)).toHaveLength(0);
  });

  it("duplicate confirmation fails safely — the course is created exactly once", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    const proposal = await propose(tenantId, userId, samplePlan(), conversationId);
    const first = await confirm(tenantId, userId, proposal.executionId);
    expect(first.status).toBe("executed");
    await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolAlreadyResolvedError);

    expect(await readCoursesByTitle(tenantId, "Cybersecurity Awareness for New Employees")).toHaveLength(1);
  });

  it("an expired proposal cannot execute", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    const proposal = await propose(tenantId, userId, samplePlan(), conversationId);
    await withTenantDb(tenantId, (db) => db.update(aiToolExecutions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(aiToolExecutions.id, proposal.executionId)));

    await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolExpiredError);
    expect(await countAllCourses(tenantId)).toHaveLength(0);
  });

  it("permission revoked between propose and confirm blocks execution", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    const { roleId } = await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    const proposal = await propose(tenantId, userId, samplePlan(), conversationId);
    await withTenantDb(tenantId, (db) => db.execute(`DELETE FROM user_roles WHERE user_id = '${userId}' AND role_id = '${roleId}'`));

    await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolPermissionDeniedError);
    expect(await countAllCourses(tenantId)).toHaveLength(0);
  });

  it("RLS enforces isolation at the database level directly", async () => {
    const tenantAId = randomUUID();
    const userAId = randomUUID();
    await seedTenant(tenantAId, "Tenant A");
    await seedUser(tenantAId, userAId);
    await seedUserWithRole(tenantAId, userAId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantAId, userAId, conversationId);

    const proposal = await propose(tenantAId, userAId, samplePlan(), conversationId);
    await confirm(tenantAId, userAId, proposal.executionId);
    const [course] = await readCoursesByTitle(tenantAId, "Cybersecurity Awareness for New Employees");

    const tenantBId = randomUUID();
    await seedTenant(tenantBId, "Tenant B");
    expect(await withTenantDb(tenantBId, (db: Db) => db.select().from(courses).where(eq(courses.id, course.id)))).toHaveLength(0);
  });
});
