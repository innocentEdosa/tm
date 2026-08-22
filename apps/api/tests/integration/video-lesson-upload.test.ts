import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";
import { __setStorageClientForTesting } from "../../src/storage/storage";
import { RecordingStorageClient } from "../unit/fixtures/recording-storage-client";
import { R2StorageClient } from "../../src/storage/r2-client";
import { MULTIPART_THRESHOLD_BYTES, MULTIPART_PART_SIZE_BYTES } from "../../src/storage/multipart-config";

type Headers = Record<string, string>;

async function createCourse(server: Awaited<ReturnType<typeof buildTestServer>>, headers: Headers) {
  const response = await server.inject({
    method: "POST",
    url: "/tenant/courses",
    headers,
    payload: { title: `Course ${randomUUID()}`, category: "Technical", deliveryMode: "virtual", duration: { value: 1, unit: "hours" } },
  });
  return response.json().data as { id: string };
}

async function createModule(server: Awaited<ReturnType<typeof buildTestServer>>, headers: Headers, courseId: string) {
  const response = await server.inject({ method: "POST", url: `/tenant/courses/${courseId}/modules`, headers, payload: { title: `Module ${randomUUID()}` } });
  return response.json().data as { id: string };
}

/** A video content item is created exactly the way the client does when the "Upload a file" method
 * is picked — an anchor row with `payload.uploadPending: true`, valid but deliberately incomplete
 * (`content-item-payload-validation.ts`). */
async function createVideoContentItem(server: Awaited<ReturnType<typeof buildTestServer>>, headers: Headers, moduleId: string) {
  const response = await server.inject({
    method: "POST",
    url: `/tenant/modules/${moduleId}/content-items`,
    headers,
    payload: { type: "video", title: `Lesson ${randomUUID()}`, payload: { uploadPending: true } },
  });
  return response.json().data as { id: string };
}

describe("video lesson upload (single-PUT and multipart)", () => {
  let recording: RecordingStorageClient;

  beforeEach(() => {
    recording = new RecordingStorageClient();
    __setStorageClientForTesting(recording);
  });

  afterEach(() => {
    __setStorageClientForTesting(new R2StorageClient());
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("a small video uses the single-PUT strategy and completing it points the lesson at the attachment", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);
      const module = await createModule(server, headers, course.id);
      const item = await createVideoContentItem(server, headers, module.id);

      const sizeBytes = 10 * 1024 * 1024; // well under the multipart threshold
      const started = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item.id}/video/upload`,
        headers,
        payload: { fileName: "lesson.mp4", contentType: "video/mp4", sizeBytes },
      });
      expect(started.statusCode).toBe(201);
      const { id: attachmentId, strategy, uploadUrl } = started.json().data;
      expect(strategy).toBe("single");
      expect(uploadUrl).toContain("recording-storage.test/upload");

      recording.simulateUpload(recording.uploadedKeys[0].key, sizeBytes);

      const completed = await server.inject({ method: "POST", url: `/tenant/attachments/${attachmentId}/video/complete`, headers });
      expect(completed.statusCode).toBe(200);
      expect(completed.json().data.attachment.status).toBe("ready");

      const lesson = await server.inject({ method: "GET", url: `/tenant/courses/${course.id}/curriculum`, headers });
      const savedItem = lesson.json().data.modules[0].contentItems.find((c: { id: string }) => c.id === item.id);
      expect(savedItem.payload).toEqual({ videoAttachmentId: attachmentId });
    } finally {
      await server.close();
    }
  });

  it("a large video uses multipart, hands out part URLs in bounded batches, and assembles on complete", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);
      const module = await createModule(server, headers, course.id);
      const item = await createVideoContentItem(server, headers, module.id);

      // Just over the threshold — big enough to force multipart, small enough to keep the test fast.
      const sizeBytes = MULTIPART_THRESHOLD_BYTES + MULTIPART_PART_SIZE_BYTES;
      const started = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item.id}/video/upload`,
        headers,
        payload: { fileName: "big-lesson.mp4", contentType: "video/mp4", sizeBytes },
      });
      expect(started.statusCode).toBe(201);
      const { id: attachmentId, strategy, partCount, partSize } = started.json().data;
      expect(strategy).toBe("multipart");
      expect(partSize).toBe(MULTIPART_PART_SIZE_BYTES);
      expect(partCount).toBe(Math.ceil(sizeBytes / MULTIPART_PART_SIZE_BYTES));

      // Request more part numbers than one batch allows — rejected before any URL is generated.
      const tooMany = await server.inject({
        method: "POST",
        url: `/tenant/attachments/${attachmentId}/video/parts`,
        headers,
        payload: { partNumbers: Array.from({ length: 11 }, (_, i) => i + 1) },
      });
      expect(tooMany.statusCode).toBe(400);

      const storageKey = recording.multipartStarted[0].key;
      const parts: { partNumber: number; eTag: string }[] = [];
      for (let n = 1; n <= partCount; n++) {
        const batch = await server.inject({ method: "POST", url: `/tenant/attachments/${attachmentId}/video/parts`, headers, payload: { partNumbers: [n] } });
        expect(batch.statusCode).toBe(200);
        expect(batch.json().data.urls[n]).toContain(`upload-part`);
        const partSizeBytes = n < partCount ? partSize : sizeBytes - partSize * (partCount - 1);
        recording.simulateUploadPart(storageKey, n, partSizeBytes);
        parts.push({ partNumber: n, eTag: `etag-${n}` });
      }

      const completed = await server.inject({
        method: "POST",
        url: `/tenant/attachments/${attachmentId}/video/complete`,
        headers,
        payload: { parts },
      });
      expect(completed.statusCode).toBe(200);
      expect(completed.json().data.attachment.status).toBe("ready");
    } finally {
      await server.close();
    }
  });

  it("rejects starting a video upload against a non-video content item", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);
      const module = await createModule(server, headers, course.id);
      const article = await server.inject({
        method: "POST",
        url: `/tenant/modules/${module.id}/content-items`,
        headers,
        payload: { type: "article", title: "Not a video", payload: { body: "text" } },
      });
      const articleId = article.json().data.id;

      const started = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${articleId}/video/upload`,
        headers,
        payload: { fileName: "x.mp4", contentType: "video/mp4", sizeBytes: 1000 },
      });
      expect(started.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("rejects a disallowed video content type and a mismatched file extension", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);
      const module = await createModule(server, headers, course.id);
      const item = await createVideoContentItem(server, headers, module.id);

      const disallowedType = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item.id}/video/upload`,
        headers,
        payload: { fileName: "clip.avi", contentType: "video/x-msvideo", sizeBytes: 1000 },
      });
      expect(disallowedType.statusCode).toBe(422);

      const mismatchedExtension = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item.id}/video/upload`,
        headers,
        payload: { fileName: "clip.pdf", contentType: "video/mp4", sizeBytes: 1000 },
      });
      expect(mismatchedExtension.statusCode).toBe(422);
      expect(recording.uploadedKeys).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("rejects a file over the size cap", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);
      const module = await createModule(server, headers, course.id);
      const item = await createVideoContentItem(server, headers, module.id);

      const tooBig = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item.id}/video/upload`,
        headers,
        payload: { fileName: "huge.mp4", contentType: "video/mp4", sizeBytes: 6 * 1024 * 1024 * 1024 },
      });
      expect(tooBig.statusCode).toBe(422);
    } finally {
      await server.close();
    }
  });

  it("aborting a pending upload deletes the attachment row and never touches the lesson", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);
      const module = await createModule(server, headers, course.id);
      const item = await createVideoContentItem(server, headers, module.id);

      const started = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item.id}/video/upload`,
        headers,
        payload: { fileName: "lesson.mp4", contentType: "video/mp4", sizeBytes: 10 * 1024 * 1024 },
      });
      const attachmentId = started.json().data.id;

      const aborted = await server.inject({ method: "POST", url: `/tenant/attachments/${attachmentId}/video/abort`, headers });
      expect(aborted.statusCode).toBe(200);

      // Re-aborting an already-gone attachment is a 404, not a crash.
      const abortedAgain = await server.inject({ method: "POST", url: `/tenant/attachments/${attachmentId}/video/abort`, headers });
      expect(abortedAgain.statusCode).toBe(404);

      const lesson = await server.inject({ method: "GET", url: `/tenant/courses/${course.id}/curriculum`, headers });
      const savedItem = lesson.json().data.modules[0].contentItems.find((c: { id: string }) => c.id === item.id);
      expect(savedItem.payload).toEqual({ uploadPending: true });
    } finally {
      await server.close();
    }
  });

  it("retrying after starting a second upload auto-cleans the stale pending one (never two rows)", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);
      const module = await createModule(server, headers, course.id);
      const item = await createVideoContentItem(server, headers, module.id);

      const first = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item.id}/video/upload`,
        headers,
        payload: { fileName: "attempt-1.mp4", contentType: "video/mp4", sizeBytes: 10 * 1024 * 1024 },
      });
      const firstAttachmentId = first.json().data.id;

      // Never completed or explicitly aborted — the user just picked a different file.
      const second = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item.id}/video/upload`,
        headers,
        payload: { fileName: "attempt-2.mp4", contentType: "video/mp4", sizeBytes: 10 * 1024 * 1024 },
      });
      expect(second.statusCode).toBe(201);
      const secondAttachmentId = second.json().data.id;
      expect(secondAttachmentId).not.toBe(firstAttachmentId);

      recording.simulateUpload(recording.uploadedKeys[recording.uploadedKeys.length - 1].key, 10 * 1024 * 1024);
      const completed = await server.inject({ method: "POST", url: `/tenant/attachments/${secondAttachmentId}/video/complete`, headers });
      expect(completed.statusCode).toBe(200);

      // The first, abandoned attempt is gone — completing/aborting it 404s.
      const completeStale = await server.inject({ method: "POST", url: `/tenant/attachments/${firstAttachmentId}/video/complete`, headers });
      expect(completeStale.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("replacing an already-uploaded video deletes the old attachment once the new one is confirmed", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);
      const module = await createModule(server, headers, course.id);
      const item = await createVideoContentItem(server, headers, module.id);

      const first = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item.id}/video/upload`,
        headers,
        payload: { fileName: "original.mp4", contentType: "video/mp4", sizeBytes: 10 * 1024 * 1024 },
      });
      const firstId = first.json().data.id;
      recording.simulateUpload(recording.uploadedKeys[0].key, 10 * 1024 * 1024);
      await server.inject({ method: "POST", url: `/tenant/attachments/${firstId}/video/complete`, headers });

      const replacement = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item.id}/video/upload`,
        headers,
        payload: { fileName: "replacement.mp4", contentType: "video/mp4", sizeBytes: 8 * 1024 * 1024 },
      });
      const replacementId = replacement.json().data.id;
      recording.simulateUpload(recording.uploadedKeys[1].key, 8 * 1024 * 1024);
      const completedReplacement = await server.inject({ method: "POST", url: `/tenant/attachments/${replacementId}/video/complete`, headers });
      expect(completedReplacement.statusCode).toBe(200);

      const lesson = await server.inject({ method: "GET", url: `/tenant/courses/${course.id}/curriculum`, headers });
      const savedItem = lesson.json().data.modules[0].contentItems.find((c: { id: string }) => c.id === item.id);
      expect(savedItem.payload).toEqual({ videoAttachmentId: replacementId });

      // The old video's object was cleaned up — never left as an orphan in R2.
      expect(recording.deletedKeys).toContain(recording.uploadedKeys[0].key);

      // The old attachment row is gone entirely.
      const oldComplete = await server.inject({ method: "POST", url: `/tenant/attachments/${firstId}/video/complete`, headers });
      expect(oldComplete.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("cannot publish a video lesson while its upload is still pending, but can once it's ready", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);
      const module = await createModule(server, headers, course.id);
      const item = await createVideoContentItem(server, headers, module.id);

      const publishWhilePending = await server.inject({ method: "PATCH", url: `/tenant/content-items/${item.id}`, headers, payload: { status: "published" } });
      expect(publishWhilePending.statusCode).toBe(422);
      expect(publishWhilePending.json().message).toContain("Cannot publish a video lesson");

      const started = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item.id}/video/upload`,
        headers,
        payload: { fileName: "lesson.mp4", contentType: "video/mp4", sizeBytes: 10 * 1024 * 1024 },
      });
      const attachmentId = started.json().data.id;
      recording.simulateUpload(recording.uploadedKeys[0].key, 10 * 1024 * 1024);
      await server.inject({ method: "POST", url: `/tenant/attachments/${attachmentId}/video/complete`, headers });

      const publishAfterReady = await server.inject({ method: "PATCH", url: `/tenant/content-items/${item.id}`, headers, payload: { status: "published" } });
      expect(publishAfterReady.statusCode).toBe(200);
      expect(publishAfterReady.json().data.status).toBe("published");
    } finally {
      await server.close();
    }
  });

  it("returns 404 for a cross-tenant video-upload attempt", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const otherTenantId = randomUUID();
    await seedTenant(otherTenantId);
    const otherUserId = randomUUID();
    await seedUser(otherTenantId, otherUserId);
    await seedUserWithRole(otherTenantId, otherUserId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);
      const module = await createModule(server, headers, course.id);
      const item = await createVideoContentItem(server, headers, module.id);

      const otherHeaders = { "x-test-user-id": otherUserId, "x-test-tenant-id": otherTenantId };
      const crossTenantStart = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item.id}/video/upload`,
        headers: otherHeaders,
        payload: { fileName: "x.mp4", contentType: "video/mp4", sizeBytes: 1000 },
      });
      expect(crossTenantStart.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });
});
