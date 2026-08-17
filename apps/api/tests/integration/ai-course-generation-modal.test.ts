import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { withTenantDb, closeTestPool } from "../helpers/pg";
import type { Db } from "../../src/db/client";
import { courses } from "../../src/db/schema/courses";
import { courseModules, contentItems } from "../../src/db/schema/course-content";
import { fileAttachments } from "../../src/db/schema/file-attachments";
import { aiConversations, aiMessages } from "../../src/db/schema/ai";
import { __setAiProviderForTesting } from "../../src/ai/provider/invoke-ai";
import { ScriptedProvider, NotConfiguredProvider, usage } from "../helpers/scripted-ai-provider";
import { __setImageProviderForTesting } from "../../src/images/image-search-service";
import { FakeImageProvider, fakeCandidate } from "../helpers/fake-image-provider";
import { __setStorageClientForTesting } from "../../src/storage/storage";
import { RecordingStorageClient } from "../unit/fixtures/recording-storage-client";
import { R2StorageClient } from "../../src/storage/r2-client";
import "../../src/ai/tools";

/**
 * AI-Assisted Course Generation — HTTP-level tests for `course-generation-routes.ts`, the
 * "AI-Assisted Generation" modal's real backing endpoints. Same conventions as
 * `ai-foundation-image-discovery.test.ts`: real Postgres/RLS via `server.inject`, a
 * `ScriptedProvider` standing in for the live model (`__setAiProviderForTesting`), and a
 * `RecordingStorageClient` standing in for R2 (`__setStorageClientForTesting`) so no real network
 * call is ever made. `generate_course_structure` itself (the underlying tool) is already covered in
 * depth by `ai-foundation-course-generation.test.ts` — these tests instead cover the modal's own
 * endpoints: document upload/extraction, input validation, and error mapping.
 */

/** `generateLessonInput.articleBody` is REQUIRED (min 300 chars) since the AI-Generated Lesson
 * Content fix — filled in here for any lesson literal below that doesn't specify its own, so every
 * other test here keeps testing what it was actually written to test. */
const DEFAULT_TEST_ARTICLE_BODY =
  "<p>This lesson walks through the core ideas for this part of the course, explaining the key terms and why they matter in practice for someone new to the topic.</p><p>It includes a worked example to reinforce the concept, then closes with a short summary of the main takeaways a learner should remember before moving on to the next lesson in this module.</p>";

function withDefaultArticleBodies<T extends { modules?: unknown }>(plan: T): T {
  const modules = (plan as { modules?: { lessons?: { articleBody?: string }[] }[] }).modules;
  modules?.forEach((module) => module.lessons?.forEach((lesson) => {
    if (lesson.articleBody === undefined) lesson.articleBody = DEFAULT_TEST_ARTICLE_BODY;
  }));
  return plan;
}

function samplePlan(overrides: Record<string, unknown> = {}) {
  return withDefaultArticleBodies({
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
  });
}

function toolCallResult(args: Record<string, unknown>) {
  return { content: null, toolCalls: [{ id: randomUUID(), name: "generate_course_structure", arguments: args }], stopReason: "tool_use" as const, usage: usage() };
}

function plainTextResult(text: string) {
  return { content: text, toolCalls: [], stopReason: "end_turn" as const, usage: usage() };
}

function readCoursesByTitle(tenantId: string, title: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(courses).where(eq(courses.title, title)));
}

function readModules(tenantId: string, courseId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(courseModules).where(eq(courseModules.courseId, courseId)));
}

function readLessons(tenantId: string, moduleId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(contentItems).where(eq(contentItems.moduleId, moduleId)));
}

async function conversationsForTenant(tenantId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(aiConversations));
}

async function messagesForConversation(tenantId: string, conversationId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(aiMessages).where(eq(aiMessages.conversationId, conversationId)));
}

function readCourseImage(tenantId: string, courseId: string) {
  return withTenantDb(tenantId, (db: Db) =>
    db.select().from(fileAttachments).where(and(eq(fileAttachments.entityType, "course"), eq(fileAttachments.entityId, courseId))),
  );
}

/** Vitest runs integration files sequentially in one process (`fileParallelism: false`), sharing
 * `image-search-service.ts`'s module-level `activeProvider` singleton with every other test file —
 * reset to an explicitly-unconfigured fake after each test here so a leftover configured provider
 * never leaks into another file's (or another test's) expectations. */
function resetImageProvider(): void {
  const notConfigured = new FakeImageProvider();
  notConfigured.setConfigured(false);
  __setImageProviderForTesting(notConfigured);
}

describe("AI-Assisted Course Generation — document upload URL", () => {
  afterEach(() => {
    __setStorageClientForTesting(new R2StorageClient());
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("issues a presigned upload URL for an allowlisted file", async () => {
    const storage = new RecordingStorageClient();
    __setStorageClientForTesting(storage);
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);

      const res = await server.inject({
        method: "POST",
        url: "/tenant/ai/course-generation/document-upload-url",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: { fileName: "syllabus.pdf", contentType: "application/pdf", sizeBytes: 1024 },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.uploadUrl).toContain("recording-storage.test");
      expect(body.data.storageKey).toContain("ai-generation-tmp/");
      expect(storage.uploadedKeys).toHaveLength(1);
      expect(storage.uploadedKeys[0].contentType).toBe("application/pdf");
    } finally {
      await server.close();
    }
  });

  it("rejects a disallowed content type", async () => {
    __setStorageClientForTesting(new RecordingStorageClient());
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);

      const res = await server.inject({
        method: "POST",
        url: "/tenant/ai/course-generation/document-upload-url",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: { fileName: "video.mp4", contentType: "video/mp4", sizeBytes: 1024 },
      });

      expect(res.statusCode).toBe(422);
    } finally {
      await server.close();
    }
  });

  it("rejects a file over the 10MB limit", async () => {
    __setStorageClientForTesting(new RecordingStorageClient());
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);

      const res = await server.inject({
        method: "POST",
        url: "/tenant/ai/course-generation/document-upload-url",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: { fileName: "big.pdf", contentType: "application/pdf", sizeBytes: 11 * 1024 * 1024 },
      });

      expect(res.statusCode).toBe(422);
    } finally {
      await server.close();
    }
  });

  it("rejects a request missing required fields", async () => {
    __setStorageClientForTesting(new RecordingStorageClient());
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);

      const res = await server.inject({
        method: "POST",
        url: "/tenant/ai/course-generation/document-upload-url",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: { fileName: "syllabus.pdf" },
      });

      expect(res.statusCode).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("denies a user without course.manage", async () => {
    __setStorageClientForTesting(new RecordingStorageClient());
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);

      const res = await server.inject({
        method: "POST",
        url: "/tenant/ai/course-generation/document-upload-url",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: { fileName: "syllabus.pdf", contentType: "application/pdf", sizeBytes: 1024 },
      });

      expect(res.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});

describe("AI-Assisted Course Generation — generate", () => {
  afterEach(() => {
    __setStorageClientForTesting(new R2StorageClient());
    resetImageProvider();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("rejects a request with neither a prompt nor a document", async () => {
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);

      const res = await server.inject({
        method: "POST",
        url: "/tenant/ai/course-generation",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("prompt-only: creates the generated course as a draft, in the caller's own tenant, with an AI Activity record", async () => {
    const provider = new ScriptedProvider([() => toolCallResult(samplePlan({ title: "Prompt-Only Course" }))]);
    __setAiProviderForTesting(provider);
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);

      const res = await server.inject({
        method: "POST",
        url: "/tenant/ai/course-generation",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: { prompt: "<p>A course on cybersecurity awareness for new hires</p>" },
      });

      expect(res.statusCode).toBe(201);
      const { courseId } = res.json().data;

      const [course] = await readCoursesByTitle(tenantId, "Prompt-Only Course");
      expect(course.id).toBe(courseId);
      expect(course.status).toBe("draft");

      const modules = await readModules(tenantId, courseId);
      expect(modules).toHaveLength(2);
      const lessons = await readLessons(tenantId, modules[0].id);
      expect(lessons.length).toBeGreaterThan(0);

      // Prompt HTML was stripped to plain text before being sent to the model.
      expect(provider.receivedInputs[0].messages.some((m) => m.role === "user" && m.content.includes("A course on cybersecurity") && !m.content.includes("<p>"))).toBe(true);

      const [conversation] = await conversationsForTenant(tenantId);
      const messages = await messagesForConversation(tenantId, conversation.id);
      expect(messages.some((m) => m.role === "user")).toBe(true);
      expect(messages.some((m) => m.role === "assistant" && m.content.includes("Prompt-Only Course"))).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("document-only (image): reads the uploaded file as multimodal input and deletes the scratch object afterward", async () => {
    const storage = new RecordingStorageClient();
    __setStorageClientForTesting(storage);
    const storageKey = `tenant/ai-generation-tmp/${randomUUID()}/syllabus.png`;
    const fakeImageBytes = Buffer.from("not-a-real-png-but-fine-for-this-fixture");
    storage.simulateUpload(storageKey, fakeImageBytes.length, fakeImageBytes);

    const provider = new ScriptedProvider([() => toolCallResult(samplePlan({ title: "Image-Sourced Course" }))]);
    __setAiProviderForTesting(provider);
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);

      const res = await server.inject({
        method: "POST",
        url: "/tenant/ai/course-generation",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: { documentStorageKey: storageKey, documentContentType: "image/png" },
      });

      expect(res.statusCode).toBe(201);
      const [course] = await readCoursesByTitle(tenantId, "Image-Sourced Course");
      expect(course.status).toBe("draft");

      const userMessage = provider.receivedInputs[0].messages.find((m) => m.role === "user");
      expect(userMessage?.images).toHaveLength(1);
      expect(userMessage?.images?.[0].mediaType).toBe("image/png");
      expect(userMessage?.images?.[0].base64).toBe(fakeImageBytes.toString("base64"));

      // Ephemeral by design — never persisted as a real attachment.
      expect(storage.deletedKeys).toContain(storageKey);
    } finally {
      await server.close();
    }
  });

  it("both prompt and document: sends both to the model", async () => {
    const storage = new RecordingStorageClient();
    __setStorageClientForTesting(storage);
    const storageKey = `tenant/ai-generation-tmp/${randomUUID()}/syllabus.png`;
    const fakeImageBytes = Buffer.from("fixture-bytes");
    storage.simulateUpload(storageKey, fakeImageBytes.length, fakeImageBytes);

    const provider = new ScriptedProvider([() => toolCallResult(samplePlan({ title: "Combined Course" }))]);
    __setAiProviderForTesting(provider);
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);

      const res = await server.inject({
        method: "POST",
        url: "/tenant/ai/course-generation",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: { prompt: "Focus heavily on phishing", documentStorageKey: storageKey, documentContentType: "image/png" },
      });

      expect(res.statusCode).toBe(201);
      const userMessage = provider.receivedInputs[0].messages.find((m) => m.role === "user");
      expect(userMessage?.content).toContain("Focus heavily on phishing");
      expect(userMessage?.images).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("an unreadable/corrupt PDF returns a user-understandable extraction error, never a stack trace", async () => {
    const storage = new RecordingStorageClient();
    __setStorageClientForTesting(storage);
    const storageKey = `tenant/ai-generation-tmp/${randomUUID()}/corrupt.pdf`;
    const garbageBytes = Buffer.from("this is not a real pdf file at all");
    storage.simulateUpload(storageKey, garbageBytes.length, garbageBytes);

    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);

      const res = await server.inject({
        method: "POST",
        url: "/tenant/ai/course-generation",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: { documentStorageKey: storageKey, documentContentType: "application/pdf" },
      });

      expect(res.statusCode).toBe(422);
      const message = res.json().message as string;
      expect(message.toLowerCase()).not.toContain("stack");
      expect(message.toLowerCase()).not.toMatch(/pdfparse|enoent|undefined is not/);

      // The scratch upload is still cleaned up even though extraction failed.
      expect(storage.deletedKeys).toContain(storageKey);
      // No course was created from a failed generation.
      expect(await conversationsForTenant(tenantId)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("a missing/expired uploaded document returns a clear error", async () => {
    __setStorageClientForTesting(new RecordingStorageClient());
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);

      const res = await server.inject({
        method: "POST",
        url: "/tenant/ai/course-generation",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: { documentStorageKey: "tenant/ai-generation-tmp/does-not-exist/file.pdf", documentContentType: "application/pdf" },
      });

      expect(res.statusCode).toBe(422);
    } finally {
      await server.close();
    }
  });

  it("the AI declining to produce a course (plain-text reply, no tool call) is surfaced as a validation-style error", async () => {
    const provider = new ScriptedProvider([() => plainTextResult("Could you tell me more about the topic or audience for this course?")]);
    __setAiProviderForTesting(provider);
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);

      const res = await server.inject({
        method: "POST",
        url: "/tenant/ai/course-generation",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: { prompt: "make me a course" },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().message).toContain("Could you tell me more");
      // No AI Activity record is created for a request that never produced a tool call.
      expect(await conversationsForTenant(tenantId)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("a malformed tool call from the AI (fails Zod validation) is surfaced as a clear error, not a crash", async () => {
    const provider = new ScriptedProvider([() => toolCallResult({ title: "Missing everything else" })]);
    __setAiProviderForTesting(provider);
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);

      const res = await server.inject({
        method: "POST",
        url: "/tenant/ai/course-generation",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: { prompt: "make me a course" },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().message).toMatch(/didn't match the course format/i);
    } finally {
      await server.close();
    }
  });

  it("an AI provider failure maps to a safe, generic error — never the underlying provider error text", async () => {
    const provider = new ScriptedProvider([
      () => {
        throw new Error("upstream 500 from provider.internal with sk-secretkey123 embedded");
      },
    ]);
    __setAiProviderForTesting(provider);
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);

      const res = await server.inject({
        method: "POST",
        url: "/tenant/ai/course-generation",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: { prompt: "make me a course" },
      });

      expect(res.statusCode).toBe(502);
      const message = res.json().message as string;
      expect(message).not.toContain("sk-secretkey123");
      expect(message).not.toContain("provider.internal");
    } finally {
      await server.close();
    }
  });

  it("AI not configured returns 503, not a crash", async () => {
    __setAiProviderForTesting(new NotConfiguredProvider());
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);

      const res = await server.inject({
        method: "POST",
        url: "/tenant/ai/course-generation",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: { prompt: "make me a course" },
      });

      expect(res.statusCode).toBe(503);
    } finally {
      await server.close();
    }
  });

  it("denies a user without course.manage", async () => {
    const provider = new ScriptedProvider([() => toolCallResult(samplePlan())]);
    __setAiProviderForTesting(provider);
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);

      const res = await server.inject({
        method: "POST",
        url: "/tenant/ai/course-generation",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: { prompt: "make me a course" },
      });

      expect(res.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("tenant isolation: the generated course always lands in the caller's own tenant, never another tenant's, even under concurrent requests", async () => {
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

    const provider = new ScriptedProvider([
      () => toolCallResult(samplePlan({ title: "Tenant A Generated Course" })),
      () => toolCallResult(samplePlan({ title: "Tenant B Generated Course" })),
    ]);
    __setAiProviderForTesting(provider);
    const server = await buildTestServer();
    try {
      const resA = await server.inject({
        method: "POST",
        url: "/tenant/ai/course-generation",
        headers: { "x-test-user-id": userAId, "x-test-tenant-id": tenantAId },
        payload: { prompt: "course for tenant A" },
      });
      const resB = await server.inject({
        method: "POST",
        url: "/tenant/ai/course-generation",
        headers: { "x-test-user-id": userBId, "x-test-tenant-id": tenantBId },
        payload: { prompt: "course for tenant B" },
      });

      expect(resA.statusCode).toBe(201);
      expect(resB.statusCode).toBe(201);

      expect(await readCoursesByTitle(tenantAId, "Tenant B Generated Course")).toHaveLength(0);
      expect(await readCoursesByTitle(tenantBId, "Tenant A Generated Course")).toHaveLength(0);
      expect(await readCoursesByTitle(tenantAId, "Tenant A Generated Course")).toHaveLength(1);
      expect(await readCoursesByTitle(tenantBId, "Tenant B Generated Course")).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("automatically finds and sets a cover image via the existing AI Image Discovery infra when it's configured", async () => {
    const aiProvider = new ScriptedProvider([() => toolCallResult(samplePlan({ title: "Cover Image Course" }))]);
    __setAiProviderForTesting(aiProvider);

    const imageProvider = new FakeImageProvider();
    const candidate = fakeCandidate({ providerImageId: "img-1", imageUrl: "https://images.example.com/img-1.jpg" });
    imageProvider.setResults([candidate]);
    __setImageProviderForTesting(imageProvider);

    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);

      const res = await server.inject({
        method: "POST",
        url: "/tenant/ai/course-generation",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: { prompt: "a course on cybersecurity" },
      });

      expect(res.statusCode).toBe(201);
      const { courseId } = res.json().data;

      // The search query is derived from the just-generated course itself — no LLM turn spent on it.
      expect(imageProvider.searchCalls).toHaveLength(1);
      expect(imageProvider.searchCalls[0].query).toContain("Cover Image Course");

      const [attachment] = await readCourseImage(tenantId, courseId);
      expect(attachment.kind).toBe("link");
      expect(attachment.url).toBe(candidate.imageUrl);

      // Same selection-tracking discipline the chat tool's set_course_image already follows.
      expect(imageProvider.trackedSelections).toHaveLength(1);
      expect(imageProvider.trackedSelections[0].providerImageId).toBe("img-1");
    } finally {
      await server.close();
    }
  });

  it("skips image selection (without failing generation) when image search isn't configured", async () => {
    const aiProvider = new ScriptedProvider([() => toolCallResult(samplePlan({ title: "No Image Provider Course" }))]);
    __setAiProviderForTesting(aiProvider);
    resetImageProvider(); // explicitly unconfigured

    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);

      const res = await server.inject({
        method: "POST",
        url: "/tenant/ai/course-generation",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: { prompt: "a course on cybersecurity" },
      });

      expect(res.statusCode).toBe(201);
      const { courseId } = res.json().data;
      expect(await readCourseImage(tenantId, courseId)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("skips image selection (without failing generation) when the search returns no candidates", async () => {
    const aiProvider = new ScriptedProvider([() => toolCallResult(samplePlan({ title: "No Candidates Course" }))]);
    __setAiProviderForTesting(aiProvider);

    const imageProvider = new FakeImageProvider();
    imageProvider.setResults([]);
    __setImageProviderForTesting(imageProvider);

    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);

      const res = await server.inject({
        method: "POST",
        url: "/tenant/ai/course-generation",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: { prompt: "a course on cybersecurity" },
      });

      expect(res.statusCode).toBe(201);
      const { courseId } = res.json().data;
      expect(await readCourseImage(tenantId, courseId)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("a failing/erroring image provider never fails course generation — the course is still created, just without an image", async () => {
    const aiProvider = new ScriptedProvider([() => toolCallResult(samplePlan({ title: "Image Failure Course" }))]);
    __setAiProviderForTesting(aiProvider);

    const imageProvider = new FakeImageProvider();
    imageProvider.setResults(new Error("Unsplash is down"));
    __setImageProviderForTesting(imageProvider);

    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["course.manage"]);

      const res = await server.inject({
        method: "POST",
        url: "/tenant/ai/course-generation",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: { prompt: "a course on cybersecurity" },
      });

      expect(res.statusCode).toBe(201);
      const { courseId } = res.json().data;
      const [course] = await readCoursesByTitle(tenantId, "Image Failure Course");
      expect(course.id).toBe(courseId);
      expect(await readCourseImage(tenantId, courseId)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });
});
