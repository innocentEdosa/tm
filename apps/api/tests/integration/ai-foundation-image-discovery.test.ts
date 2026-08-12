import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { withTenantDb, closeTestPool } from "../helpers/pg";
import type { Db } from "../../src/db/client";
import { courses } from "../../src/db/schema/courses";
import { fileAttachments } from "../../src/db/schema/file-attachments";
import { aiConversations, aiToolExecutions } from "../../src/db/schema/ai";
import { invokeTool, confirmToolExecution, rejectToolExecution, ToolPermissionDeniedError, ToolAlreadyResolvedError, ToolExpiredError, ToolInputInvalidError, type ToolInvocationResult } from "../../src/ai/execution-state-machine";
import { listTools, describeToolForProvider } from "../../src/ai/tool-registry";
import "../../src/ai/tools";
import type { ToolContext } from "../../src/ai/types";
import { __setImageProviderForTesting } from "../../src/images/image-search-service";
import { FakeImageProvider, fakeCandidate } from "../helpers/fake-image-provider";
import { ImageProviderError } from "../../src/images/image-provider";
import { __setAiProviderForTesting } from "../../src/ai/provider/invoke-ai";
import { ScriptedProvider, NotConfiguredProvider, usage } from "../helpers/scripted-ai-provider";
import { __setStorageClientForTesting } from "../../src/storage/storage";
import { RecordingStorageClient } from "../unit/fixtures/recording-storage-client";
import { R2StorageClient } from "../../src/storage/r2-client";

/**
 * AI Image Discovery & Course Asset Management Phase 1 — `search_course_images` (read-only),
 * `set_course_image`/`set_lesson_image` (mutating). Every test here uses a `FakeImageProvider`
 * (`__setImageProviderForTesting`) — never a real Unsplash call; see the phase's final report for
 * what WAS validated against the real provider separately.
 */

async function createTestCourse(tenantId: string, userId: string, server: Awaited<ReturnType<typeof buildTestServer>>, overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: "/tenant/courses",
    headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
    payload: { title: `Test Course ${randomUUID().slice(0, 8)}`, category: "Image Discovery Tests", deliveryMode: "self_paced", duration: { value: 1, unit: "hours" }, ...overrides },
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
    payload: { type: "article", title: "Lesson", payload: { body: "placeholder" }, ...overrides },
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

function readCourseImage(tenantId: string, courseId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(fileAttachments).where(and(eq(fileAttachments.entityType, "course"), eq(fileAttachments.entityId, courseId))));
}
function readLessonAttachments(tenantId: string, lessonId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(fileAttachments).where(and(eq(fileAttachments.entityType, "content_item"), eq(fileAttachments.entityId, lessonId))));
}

/** Runs `search_course_images` for real (through `invokeTool`) so its output is persisted exactly
 * like a live conversation turn would, then returns the execution id and the candidates — the
 * standard setup step almost every selection test needs. */
async function seedSearch(tenantId: string, userId: string, conversationId: string, courseId: string, candidates = [fakeCandidate()]) {
  const provider = new FakeImageProvider();
  provider.setResults(candidates);
  __setImageProviderForTesting(provider);
  const result = await propose(tenantId, userId, "search_course_images", { courseId, query: "workplace leadership" }, conversationId);
  expect(result.status).toBe("executed");
  return { executionId: result.executionId, provider, candidates };
}

describe("Image Discovery AI — tool registration", () => {
  it("all three tools are correctly tagged and distinct", () => {
    const byName = new Map(listTools().map((t) => [t.name, t]));
    for (const [name, expected] of [
      ["search_course_images", { domain: "courses", resource: "image", operation: "search", mutating: false, confirmation: false, perms: ["course.manage"] }],
      ["set_course_image", { domain: "courses", resource: "image", operation: "set_course", mutating: true, confirmation: true, perms: ["course.manage"] }],
      ["set_lesson_image", { domain: "courses", resource: "image", operation: "set_lesson", mutating: true, confirmation: true, perms: ["course.manage"] }],
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
    const searchTag = describeToolForProvider(byName.get("search_course_images")!);
    const setCourseTag = describeToolForProvider(byName.get("set_course_image")!);
    const setLessonTag = describeToolForProvider(byName.get("set_lesson_image")!);
    expect(new Set([searchTag.slice(0, 30), setCourseTag.slice(0, 30), setLessonTag.slice(0, 30)]).size).toBe(3);
  });
});

describe("Image Discovery AI — search_course_images", () => {
  afterEach(() => {
    __setImageProviderForTesting(new FakeImageProvider());
  });
  afterAll(async () => {
    await closeTestPool();
  });

  async function setup() {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    const courseId = await createTestCourse(tenantId, userId, server);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);
    return { tenantId, userId, server, courseId, conversationId };
  }

  it("returns normalized candidates from the active provider", async () => {
    const { tenantId, userId, server, courseId, conversationId } = await setup();
    try {
      const provider = new FakeImageProvider();
      provider.setResults([fakeCandidate({ providerImageId: "a" }), fakeCandidate({ providerImageId: "b" })]);
      __setImageProviderForTesting(provider);

      const result = await propose(tenantId, userId, "search_course_images", { courseId, query: "leadership workplace" }, conversationId);
      expect(result.status).toBe("executed");
      const output = result.output as { query: string; candidates: { providerImageId: string }[] };
      expect(output.query).toBe("leadership workplace");
      expect(output.candidates.map((c) => c.providerImageId)).toEqual(["a", "b"]);
      expect(provider.searchCalls[0].query).toBe("leadership workplace");
    } finally {
      await server.close();
    }
  });

  it("provider errors are handled cleanly — a failed status with a clear message, not a crash", async () => {
    const { tenantId, userId, server, courseId, conversationId } = await setup();
    try {
      const provider = new FakeImageProvider();
      provider.setResults(new ImageProviderError("Unsplash search failed with status 500"));
      __setImageProviderForTesting(provider);

      const result = await propose(tenantId, userId, "search_course_images", { courseId, query: "leadership" }, conversationId);
      expect(result.status).toBe("failed");
      expect(result.error).toMatch(/unsplash search failed/i);
    } finally {
      await server.close();
    }
  });

  it("an unconfigured provider is handled cleanly", async () => {
    const { tenantId, userId, server, courseId, conversationId } = await setup();
    try {
      const provider = new FakeImageProvider();
      provider.setConfigured(false);
      __setImageProviderForTesting(provider);

      const result = await propose(tenantId, userId, "search_course_images", { courseId, query: "leadership" }, conversationId);
      expect(result.status).toBe("failed");
      expect(result.error).toMatch(/not configured/i);
    } finally {
      await server.close();
    }
  });

  it("empty results are handled cleanly — executed with zero candidates, not an error", async () => {
    const { tenantId, userId, server, courseId, conversationId } = await setup();
    try {
      const provider = new FakeImageProvider();
      provider.setResults([]);
      __setImageProviderForTesting(provider);

      const result = await propose(tenantId, userId, "search_course_images", { courseId, query: "an extremely obscure query" }, conversationId);
      expect(result.status).toBe("executed");
      expect((result.output as { candidates: unknown[] }).candidates).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("a lessonId that doesn't belong to the given course is rejected", async () => {
    const { tenantId, userId, server, courseId, conversationId } = await setup();
    try {
      const otherCourseId = await createTestCourse(tenantId, userId, server);
      const otherModuleId = await createTestModule(tenantId, userId, otherCourseId, server);
      const foreignLessonId = await createTestLesson(tenantId, userId, otherModuleId, server);

      const provider = new FakeImageProvider();
      provider.setResults([fakeCandidate()]);
      __setImageProviderForTesting(provider);

      const result = await propose(tenantId, userId, "search_course_images", { courseId, lessonId: foreignLessonId, query: "leadership" }, conversationId);
      expect(result.status).toBe("failed");
      expect(result.error).toMatch(/does not belong to the given course/i);
    } finally {
      await server.close();
    }
  });

  it("search never writes to the database", async () => {
    const { tenantId, userId, server, courseId, conversationId } = await setup();
    try {
      const provider = new FakeImageProvider();
      provider.setResults([fakeCandidate()]);
      __setImageProviderForTesting(provider);

      await propose(tenantId, userId, "search_course_images", { courseId, query: "leadership" }, conversationId);

      const attachments = await readCourseImage(tenantId, courseId);
      expect(attachments).toHaveLength(0);
      const [course] = await withTenantDb(tenantId, (db: Db) => db.select().from(courses).where(eq(courses.id, courseId)));
      expect(course).toBeDefined(); // untouched, still exists, nothing about it changed
    } finally {
      await server.close();
    }
  });

  it("permission enforcement: a user without course.manage cannot search", async () => {
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
      const conversationId = randomUUID();
      await seedConversation(tenantId, noPermId, conversationId);
      __setImageProviderForTesting(new FakeImageProvider());

      await expect(propose(tenantId, noPermId, "search_course_images", { courseId, query: "leadership" }, conversationId)).rejects.toBeInstanceOf(ToolPermissionDeniedError);
    } finally {
      await server.close();
    }
  });
});

describe("Image Discovery AI — set_course_image", () => {
  afterEach(() => {
    __setImageProviderForTesting(new FakeImageProvider());
  });
  afterAll(async () => {
    await closeTestPool();
  });

  async function setup() {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    const courseId = await createTestCourse(tenantId, userId, server);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);
    return { tenantId, userId, server, courseId, conversationId };
  }

  it("the correct course receives the selected candidate, verified end-to-end", async () => {
    const { tenantId, userId, server, courseId, conversationId } = await setup();
    try {
      const { candidates } = await seedSearch(tenantId, userId, conversationId, courseId, [fakeCandidate({ providerImageId: "chosen-one", author: "Jane Doe" })]);
      const candidate = candidates[0];

      const proposal = await propose(
        tenantId,
        userId,
        "set_course_image",
        { courseId, providerImageId: candidate.providerImageId, imageUrl: candidate.imageUrl, previewUrl: candidate.previewUrl, title: candidate.title, author: candidate.author },
        conversationId,
      );
      expect(proposal.status).toBe("pending_confirmation");
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const [attachment] = await readCourseImage(tenantId, courseId);
      expect(attachment.kind).toBe("link");
      expect(attachment.url).toBe(candidate.imageUrl);
      expect(attachment.status).toBe("ready");
      expect(attachment.metadata).toMatchObject({ provider: "unsplash", providerImageId: "chosen-one", authorName: "Jane Doe" });
    } finally {
      await server.close();
    }
  });

  it("the course's courseImageUrl (GET /tenant/courses/:id and the list route) reflects the real hotlinked URL — a real live-testing find, not a mocked assumption", async () => {
    // Found via live testing against the real Unsplash API: the existing courseImageUrl resolution
    // (tenant-course-routes.ts's toResponseRows) only ever handled `kind: "file"` attachments
    // (presigning a storageKey) — a `kind: "link"` course image silently resolved to `courseImageUrl:
    // null`, because the map-building step only added an entry when `storageKey` was truthy. Fixed in
    // that same function; this test is the regression guard.
    const { tenantId, userId, server, courseId, conversationId } = await setup();
    try {
      const { candidates } = await seedSearch(tenantId, userId, conversationId, courseId, [fakeCandidate({ providerImageId: "read-side-check" })]);
      const candidate = candidates[0];
      const proposal = await propose(tenantId, userId, "set_course_image", { courseId, providerImageId: candidate.providerImageId, imageUrl: candidate.imageUrl, previewUrl: candidate.previewUrl }, conversationId);
      await confirm(tenantId, userId, proposal.executionId);

      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const detail = await server.inject({ method: "GET", url: `/tenant/courses/${courseId}`, headers });
      expect(detail.json().data.courseImageUrl).toBe(candidate.imageUrl);

      const list = await server.inject({ method: "GET", url: "/tenant/courses", headers });
      const listedCourse = (list.json().data as { id: string; courseImageUrl: string | null }[]).find((c) => c.id === courseId);
      expect(listedCourse?.courseImageUrl).toBe(candidate.imageUrl);
    } finally {
      await server.close();
    }
  });

  it("selection tracking is pinged exactly once on confirmation, never on propose", async () => {
    const { tenantId, userId, server, courseId, conversationId } = await setup();
    try {
      const { candidates, provider } = await seedSearch(tenantId, userId, conversationId, courseId);
      const candidate = candidates[0];
      const proposal = await propose(tenantId, userId, "set_course_image", { courseId, providerImageId: candidate.providerImageId, imageUrl: candidate.imageUrl, previewUrl: candidate.previewUrl }, conversationId);
      expect(provider.trackedSelections).toHaveLength(0); // not yet — still pending
      await confirm(tenantId, userId, proposal.executionId);
      expect(provider.trackedSelections).toHaveLength(1);
      expect(provider.trackedSelections[0].providerImageId).toBe(candidate.providerImageId);
    } finally {
      await server.close();
    }
  });

  it("wrong tenant is rejected — a cross-tenant courseId simply doesn't exist for the caller", async () => {
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
      const conversationId = randomUUID();
      await seedConversation(tenantBId, userBId, conversationId);
      const candidate = fakeCandidate();

      const proposal = await propose(tenantBId, userBId, "set_course_image", { courseId, providerImageId: candidate.providerImageId, imageUrl: candidate.imageUrl, previewUrl: candidate.previewUrl }, conversationId);
      const confirmed = await confirm(tenantBId, userBId, proposal.executionId);
      expect(confirmed.status).toBe("failed");
      // Fails at candidate resolution, not CourseService's own "course not found" — Tenant B has no
      // search history at all for Tenant A's course (RLS scopes `ai_tool_executions` too), so it
      // never gets far enough to even ask CourseService about the course. Either failure point is a
      // safe rejection; this one specifically proves RLS isolates conversation/execution history
      // across tenants, not just course rows themselves.
      expect(confirmed.error).toMatch(/couldn't find that image/i);

      const attachments = await readCourseImage(tenantAId, courseId);
      expect(attachments).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("an arbitrary provider image id (never returned by any search) is rejected — no write occurs", async () => {
    const { tenantId, userId, server, courseId, conversationId } = await setup();
    try {
      await seedSearch(tenantId, userId, conversationId, courseId, [fakeCandidate({ providerImageId: "real-one" })]);

      const proposal = await propose(
        tenantId,
        userId,
        "set_course_image",
        { courseId, providerImageId: "totally-invented-id", imageUrl: "https://images.example.com/invented", previewUrl: "https://images.example.com/invented" },
        conversationId,
      );
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("failed");
      expect(confirmed.error).toMatch(/couldn't find that image/i);

      expect(await readCourseImage(tenantId, courseId)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("an arbitrary URL paired with a REAL providerImageId is rejected — the mismatch is caught, nothing is saved", async () => {
    const { tenantId, userId, server, courseId, conversationId } = await setup();
    try {
      const { candidates } = await seedSearch(tenantId, userId, conversationId, courseId, [fakeCandidate({ providerImageId: "real-one", imageUrl: "https://images.example.com/real" })]);
      const candidate = candidates[0];

      const proposal = await propose(
        tenantId,
        userId,
        "set_course_image",
        { courseId, providerImageId: candidate.providerImageId, imageUrl: "https://evil.example.com/hacked.jpg", previewUrl: candidate.previewUrl },
        conversationId,
      );
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("failed");
      expect(confirmed.error).toMatch(/doesn't match a real search result/i);

      expect(await readCourseImage(tenantId, courseId)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("a search from a DIFFERENT course's context cannot be used to set this course's image", async () => {
    const { tenantId, userId, server, courseId, conversationId } = await setup();
    try {
      const otherCourseId = await createTestCourse(tenantId, userId, server);
      // Search performed for otherCourseId, not courseId.
      const provider = new FakeImageProvider();
      provider.setResults([fakeCandidate({ providerImageId: "other-course-image" })]);
      __setImageProviderForTesting(provider);
      await propose(tenantId, userId, "search_course_images", { courseId: otherCourseId, query: "leadership" }, conversationId);

      const proposal = await propose(
        tenantId,
        userId,
        "set_course_image",
        { courseId, providerImageId: "other-course-image", imageUrl: "https://images.example.com/fake-1-regular", previewUrl: "https://images.example.com/fake-1-thumb" },
        conversationId,
      );
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("failed");
      expect(confirmed.error).toMatch(/couldn't find that image/i);
    } finally {
      await server.close();
    }
  });

  it("proposal creates no DB change", async () => {
    const { tenantId, userId, server, courseId, conversationId } = await setup();
    try {
      const { candidates } = await seedSearch(tenantId, userId, conversationId, courseId);
      const candidate = candidates[0];
      const proposal = await propose(tenantId, userId, "set_course_image", { courseId, providerImageId: candidate.providerImageId, imageUrl: candidate.imageUrl, previewUrl: candidate.previewUrl }, conversationId);
      expect(proposal.status).toBe("pending_confirmation");
      expect(await readCourseImage(tenantId, courseId)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("rejection leaves the image unchanged", async () => {
    const { tenantId, userId, server, courseId, conversationId } = await setup();
    try {
      const { candidates } = await seedSearch(tenantId, userId, conversationId, courseId);
      const proposal = await propose(tenantId, userId, "set_course_image", { courseId, providerImageId: candidates[0].providerImageId, imageUrl: candidates[0].imageUrl, previewUrl: candidates[0].previewUrl }, conversationId);
      const rejected = await reject(tenantId, userId, proposal.executionId);
      expect(rejected.status).toBe("rejected");
      expect(await readCourseImage(tenantId, courseId)).toHaveLength(0);
      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolAlreadyResolvedError);
    } finally {
      await server.close();
    }
  });

  it("confirmation persists the correct candidate and replaces any prior image, including a real storage-backed upload", async () => {
    const { tenantId, userId, server, courseId, conversationId } = await setup();
    const recording = new RecordingStorageClient();
    __setStorageClientForTesting(recording);
    try {
      // A manually-uploaded-style prior image (kind: file, a real object in storage) already exists.
      await withTenantDb(tenantId, (db) =>
        db.insert(fileAttachments).values({ tenantId, entityType: "course", entityId: courseId, kind: "file", fileName: "old.png", contentType: "image/png", sizeBytes: 100, storageKey: `x/course/${courseId}/old.png`, status: "ready" }),
      );

      const { candidates } = await seedSearch(tenantId, userId, conversationId, courseId, [fakeCandidate({ providerImageId: "new-one" })]);
      const candidate = candidates[0];
      const proposal = await propose(tenantId, userId, "set_course_image", { courseId, providerImageId: candidate.providerImageId, imageUrl: candidate.imageUrl, previewUrl: candidate.previewUrl }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const attachments = await readCourseImage(tenantId, courseId);
      expect(attachments).toHaveLength(1); // old one replaced, not additive
      expect(attachments[0].kind).toBe("link");
      expect(attachments[0].url).toBe(candidate.imageUrl);
      expect(recording.deletedKeys).toContain(`x/course/${courseId}/old.png`); // the old upload's R2 object was cleaned up, not orphaned
    } finally {
      __setStorageClientForTesting(new R2StorageClient());
      await server.close();
    }
  });

  it("duplicate confirmation is rejected", async () => {
    const { tenantId, userId, server, courseId, conversationId } = await setup();
    try {
      const { candidates } = await seedSearch(tenantId, userId, conversationId, courseId);
      const proposal = await propose(tenantId, userId, "set_course_image", { courseId, providerImageId: candidates[0].providerImageId, imageUrl: candidates[0].imageUrl, previewUrl: candidates[0].previewUrl }, conversationId);
      const first = await confirm(tenantId, userId, proposal.executionId);
      expect(first.status).toBe("executed");
      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolAlreadyResolvedError);
    } finally {
      await server.close();
    }
  });

  it("an expired proposal cannot execute", async () => {
    const { tenantId, userId, server, courseId, conversationId } = await setup();
    try {
      const { candidates } = await seedSearch(tenantId, userId, conversationId, courseId);
      const proposal = await propose(tenantId, userId, "set_course_image", { courseId, providerImageId: candidates[0].providerImageId, imageUrl: candidates[0].imageUrl, previewUrl: candidates[0].previewUrl }, conversationId);
      await withTenantDb(tenantId, (db) => db.update(aiToolExecutions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(aiToolExecutions.id, proposal.executionId)));

      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolExpiredError);
      expect(await readCourseImage(tenantId, courseId)).toHaveLength(0);
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
      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);
      const { candidates } = await seedSearch(tenantId, userId, conversationId, courseId);

      const proposal = await propose(tenantId, userId, "set_course_image", { courseId, providerImageId: candidates[0].providerImageId, imageUrl: candidates[0].imageUrl, previewUrl: candidates[0].previewUrl }, conversationId);
      await withTenantDb(tenantId, (db) => db.execute(`DELETE FROM user_roles WHERE user_id = '${userId}' AND role_id = '${roleId}'`));

      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolPermissionDeniedError);
      expect(await readCourseImage(tenantId, courseId)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("schema validation: providerImageId, imageUrl, and previewUrl are required", async () => {
    const { tenantId, userId, conversationId, courseId, server } = await setup();
    try {
      await expect(propose(tenantId, userId, "set_course_image", { courseId, imageUrl: "https://x.com/a", previewUrl: "https://x.com/a" }, conversationId)).rejects.toBeInstanceOf(ToolInputInvalidError);
      await expect(propose(tenantId, userId, "set_course_image", { courseId, providerImageId: "a", previewUrl: "https://x.com/a" }, conversationId)).rejects.toBeInstanceOf(ToolInputInvalidError);
      await expect(propose(tenantId, userId, "set_course_image", { courseId, providerImageId: "a", imageUrl: "not-a-url", previewUrl: "https://x.com/a" }, conversationId)).rejects.toBeInstanceOf(ToolInputInvalidError);
    } finally {
      await server.close();
    }
  });
});

describe("Image Discovery AI — set_lesson_image", () => {
  afterEach(() => {
    __setImageProviderForTesting(new FakeImageProvider());
  });
  afterAll(async () => {
    await closeTestPool();
  });

  async function setup() {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const server = await buildTestServer();
    const courseId = await createTestCourse(tenantId, userId, server);
    const moduleId = await createTestModule(tenantId, userId, courseId, server);
    const lessonId = await createTestLesson(tenantId, userId, moduleId, server);
    const conversationId = randomUUID();
    await seedConversation(tenantId, userId, conversationId);
    return { tenantId, userId, server, courseId, moduleId, lessonId, conversationId };
  }

  it("the correct lesson receives the selected candidate as a Lesson Resource attachment", async () => {
    const { tenantId, userId, server, courseId, lessonId, conversationId } = await setup();
    try {
      const { candidates } = await seedSearch(tenantId, userId, conversationId, courseId, [fakeCandidate({ providerImageId: "lesson-photo" })]);
      const candidate = candidates[0];
      const proposal = await propose(
        tenantId,
        userId,
        "set_lesson_image",
        { lessonId, courseId, providerImageId: candidate.providerImageId, imageUrl: candidate.imageUrl, previewUrl: candidate.previewUrl },
        conversationId,
      );
      expect(proposal.status).toBe("pending_confirmation");
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const attachments = await readLessonAttachments(tenantId, lessonId);
      expect(attachments).toHaveLength(1);
      expect(attachments[0].kind).toBe("link");
      expect(attachments[0].url).toBe(candidate.imageUrl);
      expect(attachments[0].metadata).toMatchObject({ provider: "unsplash", providerImageId: "lesson-photo" });
    } finally {
      await server.close();
    }
  });

  it("never removes a manually-added lesson resource — only replaces a PRIOR AI-selected image", async () => {
    const { tenantId, userId, server, courseId, lessonId, conversationId } = await setup();
    try {
      // A human-added link resource already exists on this lesson.
      await withTenantDb(tenantId, (db) => db.insert(fileAttachments).values({ tenantId, entityType: "content_item", entityId: lessonId, kind: "link", fileName: "Reference doc", url: "https://example.com/doc", status: "ready" }));

      const { candidates } = await seedSearch(tenantId, userId, conversationId, courseId, [fakeCandidate({ providerImageId: "img-1" })]);
      const proposal = await propose(tenantId, userId, "set_lesson_image", { lessonId, courseId, providerImageId: candidates[0].providerImageId, imageUrl: candidates[0].imageUrl, previewUrl: candidates[0].previewUrl }, conversationId);
      await confirm(tenantId, userId, proposal.executionId);

      const attachments = await readLessonAttachments(tenantId, lessonId);
      expect(attachments).toHaveLength(2); // the human resource AND the new image, both present
      expect(attachments.some((a) => a.fileName === "Reference doc")).toBe(true);
      expect(attachments.some((a) => a.metadata !== null)).toBe(true);

      // Selecting a second image replaces only the AI one, still leaving the human resource.
      const { candidates: candidates2 } = await seedSearch(tenantId, userId, conversationId, courseId, [fakeCandidate({ providerImageId: "img-2" })]);
      const proposal2 = await propose(tenantId, userId, "set_lesson_image", { lessonId, courseId, providerImageId: candidates2[0].providerImageId, imageUrl: candidates2[0].imageUrl, previewUrl: candidates2[0].previewUrl }, conversationId);
      await confirm(tenantId, userId, proposal2.executionId);

      const afterSecond = await readLessonAttachments(tenantId, lessonId);
      expect(afterSecond).toHaveLength(2);
      expect(afterSecond.some((a) => a.fileName === "Reference doc")).toBe(true);
      const aiImage = afterSecond.find((a) => a.metadata !== null);
      expect((aiImage!.metadata as { providerImageId: string }).providerImageId).toBe("img-2");
    } finally {
      await server.close();
    }
  });

  it("a cross-course lesson cannot be targeted — mismatched lessonId/courseId is rejected", async () => {
    const { tenantId, userId, server, courseId, conversationId } = await setup();
    try {
      const otherCourseId = await createTestCourse(tenantId, userId, server);
      const otherModuleId = await createTestModule(tenantId, userId, otherCourseId, server);
      const otherLessonId = await createTestLesson(tenantId, userId, otherModuleId, server);

      const { candidates } = await seedSearch(tenantId, userId, conversationId, courseId);
      // lessonId belongs to otherCourseId, but courseId given is the original course.
      const proposal = await propose(
        tenantId,
        userId,
        "set_lesson_image",
        { lessonId: otherLessonId, courseId, providerImageId: candidates[0].providerImageId, imageUrl: candidates[0].imageUrl, previewUrl: candidates[0].previewUrl },
        conversationId,
      );
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("failed");
      expect(confirmed.error).toMatch(/does not belong to the given course/i);
      expect(await readLessonAttachments(tenantId, otherLessonId)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("an arbitrary URL is rejected", async () => {
    const { tenantId, userId, server, lessonId, courseId, conversationId } = await setup();
    try {
      const { candidates } = await seedSearch(tenantId, userId, conversationId, courseId);
      const proposal = await propose(
        tenantId,
        userId,
        "set_lesson_image",
        { lessonId, courseId, providerImageId: candidates[0].providerImageId, imageUrl: "https://evil.example.com/hacked.jpg", previewUrl: candidates[0].previewUrl },
        conversationId,
      );
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("failed");
      expect(await readLessonAttachments(tenantId, lessonId)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("rejection leaves the lesson's attachments unchanged; confirmation-after-reject fails", async () => {
    const { tenantId, userId, server, lessonId, courseId, conversationId } = await setup();
    try {
      const { candidates } = await seedSearch(tenantId, userId, conversationId, courseId);
      const proposal = await propose(tenantId, userId, "set_lesson_image", { lessonId, courseId, providerImageId: candidates[0].providerImageId, imageUrl: candidates[0].imageUrl, previewUrl: candidates[0].previewUrl }, conversationId);
      await reject(tenantId, userId, proposal.executionId);
      expect(await readLessonAttachments(tenantId, lessonId)).toHaveLength(0);
      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolAlreadyResolvedError);
    } finally {
      await server.close();
    }
  });
});

describe("Image Discovery AI — multi-turn scenarios", () => {
  afterEach(() => {
    __setAiProviderForTesting(new NotConfiguredProvider());
    __setImageProviderForTesting(new FakeImageProvider());
  });
  afterAll(async () => {
    await closeTestPool();
  });

  function confirmViaHttp(server: Awaited<ReturnType<typeof buildTestServer>>, tenantId: string, userId: string, executionId: string) {
    return server.inject({ method: "POST", url: `/ai/tool-executions/${executionId}/confirm`, headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId } });
  }

  it("Scenario: 'find images for this course' then 'use the second one' resolves the real candidate identity", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      const provider = new FakeImageProvider();
      provider.setResults([
        fakeCandidate({ providerImageId: "img-1", title: "First photo" }),
        fakeCandidate({ providerImageId: "img-2", title: "Second photo" }),
        fakeCandidate({ providerImageId: "img-3", title: "Third photo" }),
      ]);
      __setImageProviderForTesting(provider);

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({ content: null, toolCalls: [{ id: "c1", name: "search_course_images", arguments: { courseId, query: "leadership workplace professional" } }], stopReason: "tool_use", usage: usage() }),
          () => ({ content: "Here are 3 candidates.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
          (input) => {
            const toolResult = input.messages.find((m) => m.role === "tool");
            const found = JSON.parse(toolResult!.content) as { candidates: { providerImageId: string; imageUrl: string; previewUrl: string; title: string }[] };
            const second = found.candidates[1];
            return {
              content: null,
              toolCalls: [{ id: "c2", name: "set_course_image", arguments: { courseId, providerImageId: second.providerImageId, imageUrl: second.imageUrl, previewUrl: second.previewUrl, title: second.title } }],
              stopReason: "tool_use",
              usage: usage(),
            };
          },
        ]),
      );

      await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Find images for this course.", context: { courseId } } });
      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Use the second one." } });
      const execution = turn2.json().data.toolExecution;
      expect(execution.toolName).toBe("set_course_image");
      expect(execution.input.providerImageId).toBe("img-2");

      await confirmViaHttp(server, tenantId, userId, execution.id);
      const [attachment] = await readCourseImage(tenantId, courseId);
      expect(attachment.metadata).toMatchObject({ providerImageId: "img-2" });
    } finally {
      await server.close();
    }
  });

  it("Scenario: 'find an image for this lesson' then 'use the third one' resolves both lesson and candidate identity", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
    const server = await buildTestServer();
    try {
      const courseId = await createTestCourse(tenantId, userId, server);
      const moduleId = await createTestModule(tenantId, userId, courseId, server, "Introduction to Servant Leadership");
      const lessonId = await createTestLesson(tenantId, userId, moduleId, server, { title: "Empathy and Active Listening" });
      const conversationId = (await server.inject({ method: "POST", url: "/ai/conversations", headers })).json().data.id as string;

      const provider = new FakeImageProvider();
      provider.setResults([fakeCandidate({ providerImageId: "l-1" }), fakeCandidate({ providerImageId: "l-2" }), fakeCandidate({ providerImageId: "l-3" })]);
      __setImageProviderForTesting(provider);

      __setAiProviderForTesting(
        new ScriptedProvider([
          () => ({ content: null, toolCalls: [{ id: "c1", name: "search_course_images", arguments: { courseId, lessonId, query: "servant leadership empathy active listening" } }], stopReason: "tool_use", usage: usage() }),
          () => ({ content: "Here are 3 candidates for this lesson.", toolCalls: [], stopReason: "end_turn", usage: usage() }),
          (input) => {
            const toolResult = input.messages.find((m) => m.role === "tool");
            const found = JSON.parse(toolResult!.content) as { candidates: { providerImageId: string; imageUrl: string; previewUrl: string }[] };
            const third = found.candidates[2];
            return {
              content: null,
              toolCalls: [{ id: "c2", name: "set_lesson_image", arguments: { lessonId, courseId, providerImageId: third.providerImageId, imageUrl: third.imageUrl, previewUrl: third.previewUrl } }],
              stopReason: "tool_use",
              usage: usage(),
            };
          },
        ]),
      );

      await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Find an image for the Empathy and Active Listening lesson." } });
      const turn2 = await server.inject({ method: "POST", url: `/ai/conversations/${conversationId}/messages`, headers, payload: { content: "Use the third one." } });
      const execution = turn2.json().data.toolExecution;
      expect(execution.toolName).toBe("set_lesson_image");
      expect(execution.input.lessonId).toBe(lessonId);
      expect(execution.input.providerImageId).toBe("l-3");

      await confirmViaHttp(server, tenantId, userId, execution.id);
      const attachments = await readLessonAttachments(tenantId, lessonId);
      expect(attachments[0].metadata).toMatchObject({ providerImageId: "l-3" });
    } finally {
      await server.close();
    }
  });
});
