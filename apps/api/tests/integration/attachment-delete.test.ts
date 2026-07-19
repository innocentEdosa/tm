import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { __setStorageClientForTesting } from "../../src/storage/storage";
import { RecordingStorageClient } from "../unit/fixtures/recording-storage-client";
import { R2StorageClient } from "../../src/storage/r2-client";
import { deleteAllAttachmentsForEntity } from "../../src/attachments/tenant-attachment-routes";

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

async function createAttachment(
  server: Awaited<ReturnType<typeof buildTestServer>>,
  headers: Headers,
  contentItemId: string,
  recording: RecordingStorageClient,
  fileName = `file-${randomUUID()}.pdf`,
) {
  const created = await server.inject({
    method: "POST",
    url: `/tenant/content-items/${contentItemId}/attachments`,
    headers,
    payload: { fileName, contentType: "application/pdf", sizeBytes: 100 },
  });
  const data = created.json().data as { id: string };
  const key = recording.uploadedKeys[recording.uploadedKeys.length - 1].key;
  recording.simulateUpload(key, 100);
  await server.inject({ method: "POST", url: `/tenant/attachments/${data.id}/confirm`, headers });
  return data;
}

describe("attachment delete (spec US4, FR-008/FR-009/FR-010/FR-011)", () => {
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

  it("deletes an attachment; it's gone from the list and download-url is 404 afterward", async () => {
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
      const attachment = await createAttachment(server, headers, item.id, recording);

      const deleteResponse = await server.inject({ method: "DELETE", url: `/tenant/attachments/${attachment.id}`, headers });
      expect(deleteResponse.statusCode).toBe(200);
      expect(recording.deletedKeys).toHaveLength(1);

      const list = await server.inject({ method: "GET", url: `/tenant/content-items/${item.id}/attachments`, headers });
      expect(list.json().data).toEqual([]);

      const download = await server.inject({ method: "GET", url: `/tenant/attachments/${attachment.id}/download-url`, headers });
      expect(download.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("returns 404 for a delete targeting a cross-tenant/nonexistent attachment id", async () => {
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
      const otherAttachment = await createAttachment(server, otherHeaders, otherItem.id, recording);

      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const crossTenant = await server.inject({ method: "DELETE", url: `/tenant/attachments/${otherAttachment.id}`, headers });
      expect(crossTenant.statusCode).toBe(404);

      const nonexistent = await server.inject({ method: "DELETE", url: `/tenant/attachments/${randomUUID()}`, headers });
      expect(nonexistent.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("returns 403 for a course.view-only caller attempting to delete", async () => {
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
      const attachment = await createAttachment(server, managerHeaders, item.id, recording);

      const viewerHeaders = { "x-test-user-id": viewerId, "x-test-tenant-id": tenantId };
      const response = await server.inject({ method: "DELETE", url: `/tenant/attachments/${attachment.id}`, headers: viewerHeaders });
      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("deleteAllAttachmentsForEntity removes every attachment for a given entity in one call", async () => {
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
      await createAttachment(server, headers, item.id, recording, "one.pdf");
      await createAttachment(server, headers, item.id, recording, "two.pdf");

      const beforeList = await server.inject({ method: "GET", url: `/tenant/content-items/${item.id}/attachments`, headers });
      expect(beforeList.json().data).toHaveLength(2);

      await withTenantDb(tenantId, (db) => deleteAllAttachmentsForEntity(db, "content_item", item.id));
      expect(recording.deletedKeys).toHaveLength(2);

      const afterList = await server.inject({ method: "GET", url: `/tenant/content-items/${item.id}/attachments`, headers });
      expect(afterList.json().data).toEqual([]);
    } finally {
      await server.close();
    }
  });
});
