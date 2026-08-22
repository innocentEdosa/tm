import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";
import { __setStorageClientForTesting } from "../../src/storage/storage";
import { RecordingStorageClient } from "../unit/fixtures/recording-storage-client";
import { R2StorageClient } from "../../src/storage/r2-client";

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

async function createContentItem(server: Awaited<ReturnType<typeof buildTestServer>>, headers: Headers, moduleId: string) {
  const response = await server.inject({
    method: "POST",
    url: `/tenant/modules/${moduleId}/content-items`,
    headers,
    payload: { type: "article", title: `Item ${randomUUID()}`, payload: { body: "text" } },
  });
  return response.json().data as { id: string };
}

describe("attachment upload + confirm (spec US1, FR-001/FR-002/FR-004/FR-005/FR-010/FR-011/FR-012)", () => {
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

  it("returns 503 when the storage client isn't configured, before any other check (research.md §8)", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    __setStorageClientForTesting({
      isConfigured: () => false,
      createPresignedUploadUrl: async () => {
        throw new Error("should never be called when unconfigured");
      },
      headObject: async () => ({ exists: false }),
      createPresignedDownloadUrl: async () => "unused",
      deleteObject: async () => {},
      putObject: async () => {},
      getObjectStream: async () => null,
      createMultipartUpload: async () => {
        throw new Error("should never be called when unconfigured");
      },
      createPresignedUploadPartUrls: async () => ({}),
      completeMultipartUpload: async () => {},
      abortMultipartUpload: async () => {},
    });

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);
      const module = await createModule(server, headers, course.id);
      const item = await createContentItem(server, headers, module.id);

      const response = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item.id}/attachments`,
        headers,
        payload: { fileName: "test.pdf", contentType: "application/pdf", sizeBytes: 12345 },
      });
      expect(response.statusCode).toBe(503);
    } finally {
      await server.close();
    }
  });

  it("creates a pending attachment then confirms it to ready, recording createdBy", async () => {
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
      const item = await createContentItem(server, headers, module.id);

      const created = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item.id}/attachments`,
        headers,
        payload: { fileName: "test.pdf", contentType: "application/pdf", sizeBytes: 12345 },
      });
      expect(created.statusCode).toBe(201);
      const attachmentId = created.json().data.id;
      expect(created.json().data.uploadUrl).toContain("recording-storage.test/upload");
      expect(recording.uploadedKeys).toHaveLength(1);

      const key = recording.uploadedKeys[0].key;
      recording.simulateUpload(key, 12345);

      const confirmed = await server.inject({ method: "POST", url: `/tenant/attachments/${attachmentId}/confirm`, headers });
      expect(confirmed.statusCode).toBe(200);
      expect(confirmed.json().data.status).toBe("ready");
      expect(confirmed.json().data.createdBy.id).toBe(userId);
    } finally {
      await server.close();
    }
  });

  it("rejects missing required fields", async () => {
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
      const item = await createContentItem(server, headers, module.id);

      const response = await server.inject({ method: "POST", url: `/tenant/content-items/${item.id}/attachments`, headers, payload: {} });
      expect(response.statusCode).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("rejects a content type outside the allowlist before any storage interaction", async () => {
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
      const item = await createContentItem(server, headers, module.id);

      const response = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item.id}/attachments`,
        headers,
        payload: { fileName: "malware.exe", contentType: "application/x-msdownload", sizeBytes: 1000 },
      });
      expect(response.statusCode).toBe(422);
      expect(recording.uploadedKeys).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("returns 404 for a create/confirm request targeting a cross-tenant content item/attachment", async () => {
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
      const otherHeaders = { "x-test-user-id": otherUserId, "x-test-tenant-id": otherTenantId };
      const otherCourse = await createCourse(server, otherHeaders);
      const otherModule = await createModule(server, otherHeaders, otherCourse.id);
      const otherItem = await createContentItem(server, otherHeaders, otherModule.id);

      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const createResponse = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${otherItem.id}/attachments`,
        headers,
        payload: { fileName: "x.pdf", contentType: "application/pdf", sizeBytes: 100 },
      });
      expect(createResponse.statusCode).toBe(404);

      const otherAttachment = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${otherItem.id}/attachments`,
        headers: otherHeaders,
        payload: { fileName: "x.pdf", contentType: "application/pdf", sizeBytes: 100 },
      });
      const confirmResponse = await server.inject({ method: "POST", url: `/tenant/attachments/${otherAttachment.json().data.id}/confirm`, headers });
      expect(confirmResponse.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("returns 409 when confirming an attachment whose bytes were never actually uploaded", async () => {
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
      const item = await createContentItem(server, headers, module.id);

      const created = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item.id}/attachments`,
        headers,
        payload: { fileName: "test.pdf", contentType: "application/pdf", sizeBytes: 12345 },
      });
      const attachmentId = created.json().data.id;

      // Never call recording.simulateUpload — the object doesn't "exist" in the fake store.
      const confirmed = await server.inject({ method: "POST", url: `/tenant/attachments/${attachmentId}/confirm`, headers });
      expect(confirmed.statusCode).toBe(409);
    } finally {
      await server.close();
    }
  });

  it("returns 403 for a course.view-only caller on both create and confirm", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const managerId = randomUUID();
    await seedUser(tenantId, managerId);
    await seedUserWithRole(tenantId, managerId, ["course.manage"]);
    const viewerId = randomUUID();
    await seedUser(tenantId, viewerId);
    await seedUserWithRole(tenantId, viewerId, ["course.view"]);

    const server = await buildTestServer();
    try {
      const managerHeaders = { "x-test-user-id": managerId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, managerHeaders);
      const module = await createModule(server, managerHeaders, course.id);
      const item = await createContentItem(server, managerHeaders, module.id);

      const viewerHeaders = { "x-test-user-id": viewerId, "x-test-tenant-id": tenantId };
      const createResponse = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item.id}/attachments`,
        headers: viewerHeaders,
        payload: { fileName: "x.pdf", contentType: "application/pdf", sizeBytes: 100 },
      });
      expect(createResponse.statusCode).toBe(403);

      const managerAttachment = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item.id}/attachments`,
        headers: managerHeaders,
        payload: { fileName: "x.pdf", contentType: "application/pdf", sizeBytes: 100 },
      });
      const confirmResponse = await server.inject({
        method: "POST",
        url: `/tenant/attachments/${managerAttachment.json().data.id}/confirm`,
        headers: viewerHeaders,
      });
      expect(confirmResponse.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
