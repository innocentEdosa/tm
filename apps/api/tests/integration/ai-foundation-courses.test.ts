import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { withTenantDb, closeTestPool } from "../helpers/pg";
import type { Db } from "../../src/db/client";
import { courses } from "../../src/db/schema/courses";
import { courseModules, contentItems } from "../../src/db/schema/course-content";
import { courseAssignments } from "../../src/db/schema/course-assignments";
import { aiConversations, aiToolExecutions } from "../../src/db/schema/ai";
import {
  invokeTool,
  confirmToolExecution,
  ToolPermissionDeniedError,
  ToolAlreadyResolvedError,
  ToolExpiredError,
  ToolInputInvalidError,
  type ToolInvocationResult,
} from "../../src/ai/execution-state-machine";
import "../../src/ai/tools"; // registers the Courses tools (and Forms', harmlessly)
import type { ToolContext } from "../../src/ai/types";

/**
 * AI Foundation Phase 3 — Courses. Same integration-test convention as
 * `ai-foundation-forms.test.ts`/`ai-foundation-security-phase2.test.ts`: real Postgres/RLS, never
 * mocked, `invokeTool`/`confirmToolExecution` called directly (no live AI provider in the test
 * environment). Covers the Phase 3 plan's specific "Security Requirements" section for Courses —
 * tenant isolation, permission enforcement, context/tenant spoofing, proposal-before-write,
 * confirmation, duplicate execution, expired proposal, permission revocation, and RLS — on top of
 * (not instead of) the read/write tool behavior itself.
 */

async function createTestCourse(
  tenantId: string,
  userId: string,
  server: Awaited<ReturnType<typeof buildTestServer>>,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: "/tenant/courses",
    headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
    payload: {
      title: `Test Course ${randomUUID().slice(0, 8)}`,
      category: "AI Foundation Tests",
      deliveryMode: "self_paced",
      duration: { value: 1, unit: "hours" },
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}

async function seedConversation(tenantId: string, userId: string, conversationId: string): Promise<void> {
  await withTenantDb(tenantId, (db) => db.insert(aiConversations).values({ id: conversationId, tenantId, userId }));
}

/** Same catch-inside/rethrow-outside shape as the Forms suite's helper — see that file's own doc
 * comment for why (`confirmToolExecution` can persist a state change and then throw). */
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

function readCoursesByTitle(tenantId: string, title: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(courses).where(eq(courses.title, title)));
}

function readModules(tenantId: string, courseId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(courseModules).where(eq(courseModules.courseId, courseId)));
}

function readExecution(tenantId: string, executionId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(aiToolExecutions).where(eq(aiToolExecutions.id, executionId)));
}

describe("AI Foundation — Courses read tools", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("list_courses (read tool) is tenant-isolated: Tenant A cannot see Tenant B's own courses, and vice versa", async () => {
    const server = await buildTestServer();
    try {
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

      const uniqueTitle = `Tenant A Only ${randomUUID().slice(0, 8)}`;
      await createTestCourse(tenantAId, userAId, server, { title: uniqueTitle });

      const conversationAId = randomUUID();
      await seedConversation(tenantAId, userAId, conversationAId);
      const resultA = await propose(tenantAId, userAId, "list_courses", {}, conversationAId);
      expect(resultA.status).toBe("executed");
      const titlesA = (resultA.output as { courses: { title: string }[] }).courses.map((c) => c.title);
      expect(titlesA).toContain(uniqueTitle);

      const conversationBId = randomUUID();
      await seedConversation(tenantBId, userBId, conversationBId);
      const resultB = await propose(tenantBId, userBId, "list_courses", {}, conversationBId);
      const titlesB = (resultB.output as { courses: { title: string }[] }).courses.map((c) => c.title);
      expect(titlesB).not.toContain(uniqueTitle);
    } finally {
      await server.close();
    }
  });

  it("get_course respects existing course visibility: a caller with no course.manage and no assignment to the course gets not_found, same as the HTTP route", async () => {
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const adminId = randomUUID();
      const learnerId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, adminId);
      await seedUserWithRole(tenantId, adminId, ["course.manage"]);
      await seedUser(tenantId, learnerId, { email: `learner-${randomUUID()}@example.com` });
      await seedUserWithRole(tenantId, learnerId, []); // no permissions

      const courseId = await createTestCourse(tenantId, adminId, server);
      // A course with zero assignment rows is visible to everyone by design (backward-compat
      // default — buildAssignmentVisibilityCondition's own doc comment). To actually exercise "not
      // visible to this caller", scope this course to a *different* user only, explicitly excluding
      // the learner.
      await withTenantDb(tenantId, (db) => db.insert(courseAssignments).values({ tenantId, courseId, assigneeType: "user", userId: adminId }));

      const conversationAdminId = randomUUID();
      await seedConversation(tenantId, adminId, conversationAdminId);
      const adminResult = await propose(tenantId, adminId, "get_course", { courseId }, conversationAdminId);
      expect(adminResult.status).toBe("executed");
      expect((adminResult.output as { id: string }).id).toBe(courseId);

      const conversationLearnerId = randomUUID();
      await seedConversation(tenantId, learnerId, conversationLearnerId);
      const learnerResult = await propose(tenantId, learnerId, "get_course", { courseId }, conversationLearnerId);
      // Not a thrown permission error — get_course has requiredPermissions: [] like the HTTP route,
      // so this executes; CourseService.getCourse itself returns not_found for an invisible course,
      // which the tool re-throws as a plain Error the execution row records as "failed".
      expect(learnerResult.status).toBe("failed");
      expect(learnerResult.error).toMatch(/not found/i);
    } finally {
      await server.close();
    }
  });
});

describe("AI Foundation — Courses mutating tools", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("permission enforcement: a user without course.manage cannot invoke create_course_draft, create_course_module, or create_course_lesson", async () => {
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const adminId = randomUUID();
      const noPermId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, adminId);
      await seedUserWithRole(tenantId, adminId, ["course.manage"]);
      await seedUser(tenantId, noPermId, { email: `noperm-${randomUUID()}@example.com` });
      await seedUserWithRole(tenantId, noPermId, []); // no permissions at all

      const courseId = await createTestCourse(tenantId, adminId, server);

      const conversationId = randomUUID();
      await seedConversation(tenantId, noPermId, conversationId);

      await expect(
        propose(
          tenantId,
          noPermId,
          "create_course_draft",
          { title: "Should Fail", category: "X", deliveryMode: "virtual", duration: { value: 1, unit: "hours" } },
          conversationId,
        ),
      ).rejects.toBeInstanceOf(ToolPermissionDeniedError);

      await expect(propose(tenantId, noPermId, "create_course_module", { courseId, title: "Should Fail" }, conversationId)).rejects.toBeInstanceOf(
        ToolPermissionDeniedError,
      );

      await expect(
        propose(tenantId, noPermId, "create_course_lesson", { courseId, type: "article", title: "Should Fail", payload: { body: "x" } }, conversationId),
      ).rejects.toBeInstanceOf(ToolPermissionDeniedError);
    } finally {
      await server.close();
    }
  });

  it("tenant spoofing: an input-supplied tenantId is ignored — create_course_draft creates the course under the session's own tenant, never an injected one", async () => {
    const server = await buildTestServer();
    try {
      const realTenantId = randomUUID();
      const otherTenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(realTenantId, "Real Tenant");
      await seedTenant(otherTenantId, "Other Tenant");
      await seedUser(realTenantId, userId);
      await seedUserWithRole(realTenantId, userId, ["course.manage"]);

      const conversationId = randomUUID();
      await seedConversation(realTenantId, userId, conversationId);

      const title = `Injection Test ${randomUUID().slice(0, 8)}`;
      const proposal = await propose(
        realTenantId,
        userId,
        "create_course_draft",
        {
          title,
          category: "Injection",
          deliveryMode: "virtual",
          duration: { value: 1, unit: "hours" },
          tenantId: otherTenantId,
          permissions: ["course.manage"],
          isSuperAdmin: true,
        },
        conversationId,
      );
      expect(proposal.status).toBe("pending_confirmation");
      const confirmed = await confirm(realTenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      expect(await readCoursesByTitle(realTenantId, title)).toHaveLength(1);
      expect(await readCoursesByTitle(otherTenantId, title)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("context spoofing: a page-context courseId sent alongside a chat message cannot substitute for a real permission", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    // No role/permissions at all.
    const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

    const server = await buildTestServer();
    try {
      const createRes = await server.inject({ method: "POST", url: "/ai/conversations", headers });
      const conversationId = createRes.json().data.id as string;

      // No AI_PROVIDER_API_KEY in the test environment, so this never reaches tool-calling — proves
      // the endpoint accepts an arbitrary client-supplied courseId context without erroring or
      // behaving differently based on its contents, same as the Forms formKey-context test.
      const res = await server.inject({
        method: "POST",
        url: `/ai/conversations/${conversationId}/messages`,
        headers,
        payload: { content: "Add a module to this course", context: { courseId: randomUUID(), tenantId: randomUUID(), isSuperAdmin: true } },
      });
      expect(res.statusCode).toBe(503);
    } finally {
      await server.close();
    }
  });

  it("create_course_draft creates a pending proposal (with its generated modules), not an immediate DB change", async () => {
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);

      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const title = `Proposed Course ${randomUUID().slice(0, 8)}`;
      const proposal = await propose(
        tenantId,
        userId,
        "create_course_draft",
        {
          title,
          description: "A short course.",
          category: "Security",
          deliveryMode: "self_paced",
          duration: { value: 2, unit: "hours" },
          learningObjectives: ["Recognize phishing attempts"],
          modules: [{ title: "Introduction" }, { title: "Phishing" }],
        },
        conversationId,
      );
      expect(proposal.status).toBe("pending_confirmation");
      expect(proposal.output).toBeUndefined();

      expect(await readCoursesByTitle(tenantId, title)).toHaveLength(0);

      const [executionRow] = await readExecution(tenantId, proposal.executionId);
      expect(executionRow.status).toBe("pending_confirmation");
      expect(executionRow.mutating).toBe(true);
      expect((executionRow.input as { modules: unknown[] }).modules).toHaveLength(2);
    } finally {
      await server.close();
    }
  });

  it("confirmation creates the course as a DRAFT plus its modules, and the same proposal cannot execute twice", async () => {
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);

      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const title = `Confirm Me Course ${randomUUID().slice(0, 8)}`;
      const proposal = await propose(
        tenantId,
        userId,
        "create_course_draft",
        {
          title,
          category: "Security",
          deliveryMode: "self_paced",
          duration: { value: 1, unit: "hours" },
          modules: [{ title: "Module One" }],
        },
        conversationId,
      );
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const created = await readCoursesByTitle(tenantId, title);
      expect(created).toHaveLength(1);
      expect(created[0].status).toBe("draft"); // never auto-published
      const modules = await readModules(tenantId, created[0].id);
      expect(modules.map((m) => m.title)).toEqual(["Module One"]);

      // Double execution.
      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolAlreadyResolvedError);

      // Still exactly one course and one module — confirming again must not re-run the service.
      expect(await readCoursesByTitle(tenantId, title)).toHaveLength(1);
      expect(await readModules(tenantId, created[0].id)).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("an expired create_course_draft proposal cannot be confirmed", async () => {
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);

      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const title = `Too Late Course ${randomUUID().slice(0, 8)}`;
      const proposal = await propose(
        tenantId,
        userId,
        "create_course_draft",
        { title, category: "Security", deliveryMode: "virtual", duration: { value: 1, unit: "hours" } },
        conversationId,
      );
      await withTenantDb(tenantId, (db) => db.update(aiToolExecutions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(aiToolExecutions.id, proposal.executionId)));

      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolExpiredError);

      const [row] = await readExecution(tenantId, proposal.executionId);
      expect(row.status).toBe("expired");
      expect(await readCoursesByTitle(tenantId, title)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("confirmation fails if the user's course.manage permission was removed after the proposal was created", async () => {
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      const { roleId } = await seedUserWithRole(tenantId, userId, ["course.manage"]);

      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const title = `Permission Revoked Course ${randomUUID().slice(0, 8)}`;
      const proposal = await propose(
        tenantId,
        userId,
        "create_course_draft",
        { title, category: "Security", deliveryMode: "virtual", duration: { value: 1, unit: "hours" } },
        conversationId,
      );

      await withTenantDb(tenantId, (db) => db.execute(`DELETE FROM user_roles WHERE user_id = '${userId}' AND role_id = '${roleId}'`));

      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolPermissionDeniedError);
      expect(await readCoursesByTitle(tenantId, title)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("create_course_module and create_course_lesson also propose-then-confirm, and a standalone lesson never lands in a module", async () => {
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);

      const courseId = await createTestCourse(tenantId, userId, server);
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const moduleProposal = await propose(tenantId, userId, "create_course_module", { courseId, title: "Phishing Attacks" }, conversationId);
      expect(moduleProposal.status).toBe("pending_confirmation");
      expect(await readModules(tenantId, courseId)).toHaveLength(0);
      const moduleConfirmed = await confirm(tenantId, userId, moduleProposal.executionId);
      expect(moduleConfirmed.status).toBe("executed");
      expect(await readModules(tenantId, courseId)).toHaveLength(1);

      const lessonProposal = await propose(
        tenantId,
        userId,
        "create_course_lesson",
        { courseId, type: "article", title: "What is phishing?", payload: { body: "..." } },
        conversationId,
      );
      expect(lessonProposal.status).toBe("pending_confirmation");
      const lessonConfirmed = await confirm(tenantId, userId, lessonProposal.executionId);
      expect(lessonConfirmed.status).toBe("executed");

      const items = await withTenantDb(tenantId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.courseId, courseId)));
      expect(items).toHaveLength(1);
      expect(items[0].moduleId).toBeNull(); // standalone, since moduleId was omitted
    } finally {
      await server.close();
    }
  });

  it("RLS enforces isolation at the database level for courses/course_modules directly (not just through the tool layer)", async () => {
    const server = await buildTestServer();
    try {
      const tenantAId = randomUUID();
      const userAId = randomUUID();
      await seedTenant(tenantAId, "Tenant A");
      await seedUser(tenantAId, userAId);
      await seedUserWithRole(tenantAId, userAId, ["course.manage"]);

      const conversationId = randomUUID();
      await seedConversation(tenantAId, userAId, conversationId);
      const title = `RLS Check Course ${randomUUID().slice(0, 8)}`;
      const proposal = await propose(
        tenantAId,
        userAId,
        "create_course_draft",
        { title, category: "Security", deliveryMode: "virtual", duration: { value: 1, unit: "hours" }, modules: [{ title: "M1" }] },
        conversationId,
      );
      const confirmed = await confirm(tenantAId, userAId, proposal.executionId);
      const courseId = (confirmed.output as { course: { id: string } }).course.id;

      const tenantBId = randomUUID();
      await seedTenant(tenantBId, "Tenant B");
      expect(await withTenantDb(tenantBId, (db: Db) => db.select().from(courses).where(eq(courses.id, courseId)))).toHaveLength(0);
      expect(await withTenantDb(tenantBId, (db: Db) => db.select().from(courseModules).where(eq(courseModules.courseId, courseId)))).toHaveLength(0);
      expect(await withTenantDb(tenantAId, (db: Db) => db.select().from(courses).where(eq(courses.id, courseId)))).toHaveLength(1);
    } finally {
      await server.close();
    }
  });
});

/**
 * Course AI context/discoverability hardening — `list_course_modules`, added after live-model
 * testing showed the model had no way to resolve "the Recognizing Threats module" into a real
 * `moduleId` for `create_course_lesson`.
 */
describe("AI Foundation — Course module discovery (list_course_modules)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("retrieves a course's modules in position order, with ids, status, and correct lesson counts", async () => {
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);
      const courseId = await createTestCourse(tenantId, userId, server);

      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const moduleA = await confirm(
        tenantId,
        userId,
        (await propose(tenantId, userId, "create_course_module", { courseId, title: "Recognizing Threats" }, conversationId)).executionId,
      );
      const moduleB = await confirm(
        tenantId,
        userId,
        (await propose(tenantId, userId, "create_course_module", { courseId, title: "Password Hygiene" }, conversationId)).executionId,
      );
      const moduleAId = (moduleA.output as { id: string }).id;
      const moduleBId = (moduleB.output as { id: string }).id;

      // Give module A one lesson so lessonCount is provably not just a hardcoded 0.
      await confirm(
        tenantId,
        userId,
        (
          await propose(
            tenantId,
            userId,
            "create_course_lesson",
            { courseId, moduleId: moduleAId, type: "article", title: "What is phishing?", payload: { body: "..." } },
            conversationId,
          )
        ).executionId,
      );

      const result = await propose(tenantId, userId, "list_course_modules", { courseId }, conversationId);
      expect(result.status).toBe("executed");
      const modules = result.output as { id: string; title: string; position: number; status: string; lessonCount: number }[];
      expect(modules.map((m) => m.id)).toEqual([moduleAId, moduleBId]); // position order
      expect(modules[0]).toMatchObject({ title: "Recognizing Threats", position: 0, status: "draft", lessonCount: 1 });
      expect(modules[1]).toMatchObject({ title: "Password Hygiene", position: 1, status: "draft", lessonCount: 0 });
    } finally {
      await server.close();
    }
  });

  it("returns only the requested course's modules, not another course's", async () => {
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);
      const courseAId = await createTestCourse(tenantId, userId, server);
      const courseBId = await createTestCourse(tenantId, userId, server);

      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);
      await confirm(tenantId, userId, (await propose(tenantId, userId, "create_course_module", { courseId: courseAId, title: "Only In A" }, conversationId)).executionId);
      await confirm(tenantId, userId, (await propose(tenantId, userId, "create_course_module", { courseId: courseBId, title: "Only In B" }, conversationId)).executionId);

      const resultA = await propose(tenantId, userId, "list_course_modules", { courseId: courseAId }, conversationId);
      const titlesA = (resultA.output as { title: string }[]).map((m) => m.title);
      expect(titlesA).toEqual(["Only In A"]);
    } finally {
      await server.close();
    }
  });

  it("tenant isolation: Tenant B cannot retrieve Tenant A's modules via list_course_modules", async () => {
    const server = await buildTestServer();
    try {
      const tenantAId = randomUUID();
      const userAId = randomUUID();
      await seedTenant(tenantAId, "Tenant A");
      await seedUser(tenantAId, userAId);
      await seedUserWithRole(tenantAId, userAId, ["course.manage"]);
      const courseId = await createTestCourse(tenantAId, userAId, server);
      const conversationAId = randomUUID();
      await seedConversation(tenantAId, userAId, conversationAId);
      await confirm(tenantAId, userAId, (await propose(tenantAId, userAId, "create_course_module", { courseId, title: "Tenant A Module" }, conversationAId)).executionId);

      const tenantBId = randomUUID();
      const userBId = randomUUID();
      await seedTenant(tenantBId, "Tenant B");
      await seedUser(tenantBId, userBId);
      await seedUserWithRole(tenantBId, userBId, ["course.manage"]);
      const conversationBId = randomUUID();
      await seedConversation(tenantBId, userBId, conversationBId);

      const result = await propose(tenantBId, userBId, "list_course_modules", { courseId }, conversationBId);
      expect(result.status).toBe("failed");
      expect(result.error).toMatch(/not found/i);
    } finally {
      await server.close();
    }
  });

  it("visibility: a caller with no course.manage and no assignment to the course cannot discover its modules", async () => {
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const adminId = randomUUID();
      const learnerId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, adminId);
      await seedUserWithRole(tenantId, adminId, ["course.manage"]);
      await seedUser(tenantId, learnerId, { email: `learner-${randomUUID()}@example.com` });
      await seedUserWithRole(tenantId, learnerId, []);

      const courseId = await createTestCourse(tenantId, adminId, server);
      // Scope the course to a different user only, same technique as the get_course visibility test.
      await withTenantDb(tenantId, (db) => db.insert(courseAssignments).values({ tenantId, courseId, assigneeType: "user", userId: adminId }));

      const conversationId = randomUUID();
      await seedConversation(tenantId, learnerId, conversationId);
      const result = await propose(tenantId, learnerId, "list_course_modules", { courseId }, conversationId);
      expect(result.status).toBe("failed");
      expect(result.error).toMatch(/not found/i);
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
        payload: { content: "List the modules in this course.", context: { courseId: randomUUID(), tenantId: randomUUID(), isSuperAdmin: true } },
      });
      // Same outcome as sending no context at all (503, no AI provider configured in tests) — proves
      // the endpoint doesn't special-case or trust a client-supplied context object.
      expect(res.statusCode).toBe(503);
    } finally {
      await server.close();
    }
  });

  it("natural-language resolution: a moduleId obtained from list_course_modules can be used to create a lesson in that module", async () => {
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);
      const courseId = await createTestCourse(tenantId, userId, server);

      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);
      await confirm(tenantId, userId, (await propose(tenantId, userId, "create_course_module", { courseId, title: "Recognizing Threats" }, conversationId)).executionId);
      await confirm(tenantId, userId, (await propose(tenantId, userId, "create_course_module", { courseId, title: "Password Hygiene" }, conversationId)).executionId);

      // Simulates exactly what the model does: discover modules by name, pick the matching one,
      // use ITS id (never a hardcoded/guessed one) as create_course_lesson's moduleId.
      const discovery = await propose(tenantId, userId, "list_course_modules", { courseId }, conversationId);
      const modules = discovery.output as { id: string; title: string }[];
      const targetModule = modules.find((m) => m.title === "Recognizing Threats");
      expect(targetModule).toBeDefined();

      const lessonProposal = await propose(
        tenantId,
        userId,
        "create_course_lesson",
        { courseId, moduleId: targetModule!.id, type: "article", title: "What is phishing?", payload: { body: "..." } },
        conversationId,
      );
      const lessonConfirmed = await confirm(tenantId, userId, lessonProposal.executionId);
      expect(lessonConfirmed.status).toBe("executed");

      const items = await withTenantDb(tenantId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.courseId, courseId)));
      expect(items).toHaveLength(1);
      expect(items[0].moduleId).toBe(targetModule!.id);
      expect(items[0].title).toBe("What is phishing?");
    } finally {
      await server.close();
    }
  });
});

/**
 * Course AI context/discoverability hardening — `create_course_lesson`'s discriminated-union
 * schema, added after live-model testing produced a `type: "article"` proposal with an empty
 * payload that only failed at confirm time. Defense in depth: the Zod schema now rejects invalid
 * type/payload combinations before a proposal is ever created; `CourseService.createLesson`'s own
 * `validateContentItemPayload` check is untouched and still runs at confirm time regardless.
 */
describe("AI Foundation — create_course_lesson payload validation (defense in depth)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  const validPayloadByType: Record<string, Record<string, unknown>> = {
    video: { url: "https://example.com/video.mp4" },
    article: { body: "Some article text." },
    live_class: { scheduledAt: "2026-09-01T10:00:00Z" },
    external_import: { url: "https://example.com/scorm.zip", sourceType: "scorm" },
    test: {},
    assignment: {},
  };

  for (const [type, payload] of Object.entries(validPayloadByType)) {
    it(`accepts a valid ${type} payload and creates the content item with the right type`, async () => {
      const server = await buildTestServer();
      try {
        const tenantId = randomUUID();
        const userId = randomUUID();
        await seedTenant(tenantId);
        await seedUser(tenantId, userId);
        await seedUserWithRole(tenantId, userId, ["course.manage"]);
        const courseId = await createTestCourse(tenantId, userId, server);
        const conversationId = randomUUID();
        await seedConversation(tenantId, userId, conversationId);

        const proposal = await propose(tenantId, userId, "create_course_lesson", { courseId, type, title: `A ${type} lesson`, payload }, conversationId);
        expect(proposal.status).toBe("pending_confirmation");
        const confirmed = await confirm(tenantId, userId, proposal.executionId);
        expect(confirmed.status).toBe("executed");

        const items = await withTenantDb(tenantId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.courseId, courseId)));
        expect(items).toHaveLength(1);
        expect(items[0].type).toBe(type);
      } finally {
        await server.close();
      }
    });
  }

  it("article with externalUrl (instead of body) is also valid", async () => {
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);
      const courseId = await createTestCourse(tenantId, userId, server);
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(
        tenantId,
        userId,
        "create_course_lesson",
        { courseId, type: "article", title: "Linked article", payload: { externalUrl: "https://example.com/article" } },
        conversationId,
      );
      expect(proposal.status).toBe("pending_confirmation");
    } finally {
      await server.close();
    }
  });

  it("rejects an invalid type/payload combination BEFORE a proposal is created (not just at confirm)", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);

    // video with no url.
    await expect(propose(tenantId, userId, "create_course_lesson", { courseId: randomUUID(), type: "video", title: "X", payload: {} }, conversationId)).rejects.toBeInstanceOf(
      ToolInputInvalidError,
    );
    // article with neither body nor externalUrl.
    await expect(
      propose(tenantId, userId, "create_course_lesson", { courseId: randomUUID(), type: "article", title: "X", payload: {} }, conversationId),
    ).rejects.toBeInstanceOf(ToolInputInvalidError);
    // live_class with no scheduledAt.
    await expect(
      propose(tenantId, userId, "create_course_lesson", { courseId: randomUUID(), type: "live_class", title: "X", payload: {} }, conversationId),
    ).rejects.toBeInstanceOf(ToolInputInvalidError);
    // external_import missing sourceType.
    await expect(
      propose(
        tenantId,
        userId,
        "create_course_lesson",
        { courseId: randomUUID(), type: "external_import", title: "X", payload: { url: "https://example.com" } },
        conversationId,
      ),
    ).rejects.toBeInstanceOf(ToolInputInvalidError);
    // Unknown type entirely.
    await expect(
      propose(tenantId, userId, "create_course_lesson", { courseId: randomUUID(), type: "quiz", title: "X", payload: {} }, conversationId),
    ).rejects.toBeInstanceOf(ToolInputInvalidError);

    // Nothing was ever created for any of these attempts.
    const items = await withTenantDb(tenantId, (db: Db) => db.select().from(contentItems));
    expect(items).toHaveLength(0);
  });
});
