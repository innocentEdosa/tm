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

/** Creates an attachment and, unless `leavePending` is set, confirms it via the recording client. */
async function createAttachment(
  server: Awaited<ReturnType<typeof buildTestServer>>,
  headers: Headers,
  contentItemId: string,
  recording: RecordingStorageClient,
  options: { leavePending?: boolean; fileName?: string } = {},
) {
  const created = await server.inject({
    method: "POST",
    url: `/tenant/content-items/${contentItemId}/attachments`,
    headers,
    payload: { fileName: options.fileName ?? `file-${randomUUID()}.pdf`, contentType: "application/pdf", sizeBytes: 100 },
  });
  const data = created.json().data as { id: string };
  if (!options.leavePending) {
    const key = recording.uploadedKeys[recording.uploadedKeys.length - 1].key;
    recording.simulateUpload(key, 100);
    await server.inject({ method: "POST", url: `/tenant/attachments/${data.id}/confirm`, headers });
  }
  return data;
}

describe("attachment list + download (spec US2 + US3, FR-006/FR-007/FR-010/FR-011)", () => {
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

  it("lists only ready attachments in order, excludes pending ones", async () => {
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

      await createAttachment(server, headers, item.id, recording, { fileName: "one.pdf" });
      await createAttachment(server, headers, item.id, recording, { fileName: "two.pdf" });
      await createAttachment(server, headers, item.id, recording, { fileName: "abandoned.pdf", leavePending: true });

      const list = await server.inject({ method: "GET", url: `/tenant/content-items/${item.id}/attachments`, headers });
      expect(list.statusCode).toBe(200);
      const fileNames = list.json().data.map((a: { fileName: string }) => a.fileName);
      expect(fileNames).toEqual(["one.pdf", "two.pdf"]);
    } finally {
      await server.close();
    }
  });

  it("returns an empty list for a content item with zero attachments", async () => {
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

      const list = await server.inject({ method: "GET", url: `/tenant/content-items/${item.id}/attachments`, headers });
      expect(list.statusCode).toBe(200);
      expect(list.json().data).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("returns a download url for a ready attachment; 404 for a pending or nonexistent one", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage", "course.view"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);
      const module = await createModule(server, headers, course.id);
      const item = await createContentItem(server, headers, module.id);

      const ready = await createAttachment(server, headers, item.id, recording);
      const readyDownload = await server.inject({ method: "GET", url: `/tenant/attachments/${ready.id}/download-url`, headers });
      expect(readyDownload.statusCode).toBe(200);
      expect(readyDownload.json().data.downloadUrl).toContain("recording-storage.test/download");

      const pending = await createAttachment(server, headers, item.id, recording, { leavePending: true });
      const pendingDownload = await server.inject({ method: "GET", url: `/tenant/attachments/${pending.id}/download-url`, headers });
      expect(pendingDownload.statusCode).toBe(404);

      const nonexistentDownload = await server.inject({ method: "GET", url: `/tenant/attachments/${randomUUID()}/download-url`, headers });
      expect(nonexistentDownload.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("returns 404 for a cross-tenant content item on list, and a cross-tenant attachment on download-url", async () => {
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
      const item = await createContentItem(server, headers, module.id);
      const attachment = await createAttachment(server, headers, item.id, recording);

      const otherHeaders = { "x-test-user-id": otherUserId, "x-test-tenant-id": otherTenantId };
      const listResponse = await server.inject({ method: "GET", url: `/tenant/content-items/${item.id}/attachments`, headers: otherHeaders });
      expect(listResponse.statusCode).toBe(404);

      const downloadResponse = await server.inject({ method: "GET", url: `/tenant/attachments/${attachment.id}/download-url`, headers: otherHeaders });
      expect(downloadResponse.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("returns 403 for a caller holding neither course.view nor course.manage on both list and download-url", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const managerId = randomUUID();
    await seedUser(tenantId, managerId);
    await seedUserWithRole(tenantId, managerId, ["course.manage"]);
    const noPermId = randomUUID();
    await seedUser(tenantId, noPermId);
    await seedUserWithRole(tenantId, noPermId, []);

    const server = await buildTestServer();
    try {
      const managerHeaders = { "x-test-user-id": managerId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, managerHeaders);
      const module = await createModule(server, managerHeaders, course.id);
      const item = await createContentItem(server, managerHeaders, module.id);
      const attachment = await createAttachment(server, managerHeaders, item.id, recording);

      const noPermHeaders = { "x-test-user-id": noPermId, "x-test-tenant-id": tenantId };
      const listResponse = await server.inject({ method: "GET", url: `/tenant/content-items/${item.id}/attachments`, headers: noPermHeaders });
      expect(listResponse.statusCode).toBe(403);

      const downloadResponse = await server.inject({ method: "GET", url: `/tenant/attachments/${attachment.id}/download-url`, headers: noPermHeaders });
      expect(downloadResponse.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
