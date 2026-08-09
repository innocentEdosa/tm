import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole, seedSuperAdminSession } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { __setStorageClientForTesting } from "../../src/storage/storage";
import { RecordingStorageClient } from "../unit/fixtures/recording-storage-client";
import { R2StorageClient } from "../../src/storage/r2-client";
import { deleteAllAttachmentsForEntity } from "../../src/attachments/tenant-attachment-routes";

type Server = Awaited<ReturnType<typeof buildTestServer>>;
type Headers = Record<string, string>;

async function createCourse(server: Server, headers: Headers) {
  const response = await server.inject({
    method: "POST",
    url: "/tenant/courses",
    headers,
    payload: { title: `Course ${randomUUID()}`, category: "Technical", deliveryMode: "virtual", duration: { value: 1, unit: "hours" } },
  });
  return response.json().data as { id: string };
}

async function createModule(server: Server, headers: Headers, courseId: string) {
  const response = await server.inject({ method: "POST", url: `/tenant/courses/${courseId}/modules`, headers, payload: { title: `Module ${randomUUID()}` } });
  return response.json().data as { id: string };
}

async function createContentItem(server: Server, headers: Headers, moduleId: string) {
  const response = await server.inject({
    method: "POST",
    url: `/tenant/modules/${moduleId}/content-items`,
    headers,
    payload: { type: "article", title: `Item ${randomUUID()}`, payload: { body: "text" } },
  });
  return response.json().data as { id: string };
}

/** Uploads + confirms a real (`status:'ready'`) attachment, mirroring attachment-delete.test.ts's own helper. */
async function createReadyAttachment(
  server: Server,
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
  return { id: data.id, storageKey: key };
}

function keyFromDownloadUrl(url: string): string {
  return decodeURIComponent(url.split("/download/")[1]);
}

describe("Course Creation File Manager — file reuse + shared-storage-key delete safety", () => {
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

  it("GET /tenant/files lists the tenant's ready files deduped by storage key, and never another tenant's files", async () => {
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
      const item1 = await createContentItem(server, headers, module.id);
      const item2 = await createContentItem(server, headers, module.id);

      const fileA = await createReadyAttachment(server, headers, item1.id, recording, "a.pdf");
      await createReadyAttachment(server, headers, item1.id, recording, "b.pdf");

      // Reuse fileA onto item2 — the picker must still show 2 files (deduped by storage key), not 3.
      const reuse = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item2.id}/attachments/reuse`,
        headers,
        payload: { sourceAttachmentId: fileA.id },
      });
      expect(reuse.statusCode).toBe(201);

      const otherHeaders = { "x-test-user-id": otherUserId, "x-test-tenant-id": otherTenantId };
      const otherCourse = await createCourse(server, otherHeaders);
      const otherModule = await createModule(server, otherHeaders, otherCourse.id);
      const otherItem = await createContentItem(server, otherHeaders, otherModule.id);
      await createReadyAttachment(server, otherHeaders, otherItem.id, recording, "other-tenant-file.pdf");

      const listA = await server.inject({ method: "GET", url: "/tenant/files", headers });
      const namesA = (listA.json().data as { fileName: string }[]).map((f) => f.fileName).sort();
      expect(namesA).toEqual(["a.pdf", "b.pdf"]);

      const listB = await server.inject({ method: "GET", url: "/tenant/files", headers: otherHeaders });
      const namesB = (listB.json().data as { fileName: string }[]).map((f) => f.fileName);
      expect(namesB).toEqual(["other-tenant-file.pdf"]);
    } finally {
      await server.close();
    }
  });

  it("reuses an existing tenant file onto another content item without a new upload, referencing the same storage key", async () => {
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
      const item1 = await createContentItem(server, headers, module.id);
      const item2 = await createContentItem(server, headers, module.id);

      const original = await createReadyAttachment(server, headers, item1.id, recording, "handout.pdf");
      expect(recording.uploadedKeys).toHaveLength(1);

      const reuse = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item2.id}/attachments/reuse`,
        headers,
        payload: { sourceAttachmentId: original.id },
      });
      expect(reuse.statusCode).toBe(201);
      const reused = reuse.json().data as { id: string; fileName: string; status: string };
      expect(reused.fileName).toBe("handout.pdf");
      expect(reused.status).toBe("ready");
      expect(reused.id).not.toBe(original.id);

      // No new R2 upload happened.
      expect(recording.uploadedKeys).toHaveLength(1);

      const item2List = await server.inject({ method: "GET", url: `/tenant/content-items/${item2.id}/attachments`, headers });
      expect(item2List.json().data).toHaveLength(1);

      // Both attachments resolve to the exact same underlying storage object.
      const downloadOriginal = await server.inject({ method: "GET", url: `/tenant/attachments/${original.id}/download-url`, headers });
      const downloadReused = await server.inject({ method: "GET", url: `/tenant/attachments/${reused.id}/download-url`, headers });
      expect(keyFromDownloadUrl(downloadReused.json().data.downloadUrl)).toBe(keyFromDownloadUrl(downloadOriginal.json().data.downloadUrl));
    } finally {
      await server.close();
    }
  });

  it("returns 404 reusing a cross-tenant attachment id, even for a caller with course.manage", async () => {
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
      const otherFile = await createReadyAttachment(server, otherHeaders, otherItem.id, recording);

      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);
      const module = await createModule(server, headers, course.id);
      const item = await createContentItem(server, headers, module.id);

      const reuse = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item.id}/attachments/reuse`,
        headers,
        payload: { sourceAttachmentId: otherFile.id },
      });
      expect(reuse.statusCode).toBe(404);
      expect(recording.uploadedKeys).toHaveLength(1); // only the other tenant's original upload
    } finally {
      await server.close();
    }
  });

  it("returns 422 reusing a pending (not yet confirmed) or link-kind attachment", async () => {
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
      const item1 = await createContentItem(server, headers, module.id);
      const item2 = await createContentItem(server, headers, module.id);

      const pending = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item1.id}/attachments`,
        headers,
        payload: { fileName: "not-confirmed.pdf", contentType: "application/pdf", sizeBytes: 100 },
      });
      const pendingReuse = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item2.id}/attachments/reuse`,
        headers,
        payload: { sourceAttachmentId: pending.json().data.id },
      });
      expect(pendingReuse.statusCode).toBe(422);

      const link = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item1.id}/attachments`,
        headers,
        payload: { kind: "link", fileName: "External link", url: "https://example.com" },
      });
      const linkReuse = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item2.id}/attachments/reuse`,
        headers,
        payload: { sourceAttachmentId: link.json().data.id },
      });
      expect(linkReuse.statusCode).toBe(422);
    } finally {
      await server.close();
    }
  });

  it("deleting one of two attachments sharing a storage key does not delete the R2 object; deleting the last one does", async () => {
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
      const item1 = await createContentItem(server, headers, module.id);
      const item2 = await createContentItem(server, headers, module.id);

      const original = await createReadyAttachment(server, headers, item1.id, recording, "shared.pdf");
      const reuse = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item2.id}/attachments/reuse`,
        headers,
        payload: { sourceAttachmentId: original.id },
      });
      const reused = reuse.json().data as { id: string };

      const firstDelete = await server.inject({ method: "DELETE", url: `/tenant/attachments/${original.id}`, headers });
      expect(firstDelete.statusCode).toBe(200);
      expect(recording.deletedKeys).toHaveLength(0); // item2's row still references this key

      const item2List = await server.inject({ method: "GET", url: `/tenant/content-items/${item2.id}/attachments`, headers });
      expect(item2List.json().data).toHaveLength(1);
      const stillDownloadable = await server.inject({ method: "GET", url: `/tenant/attachments/${reused.id}/download-url`, headers });
      expect(stillDownloadable.statusCode).toBe(200);

      const secondDelete = await server.inject({ method: "DELETE", url: `/tenant/attachments/${reused.id}`, headers });
      expect(secondDelete.statusCode).toBe(200);
      expect(recording.deletedKeys).toHaveLength(1);
      expect(recording.deletedKeys[0]).toBe(original.storageKey);
    } finally {
      await server.close();
    }
  });

  it("deleteAllAttachmentsForEntity (bulk delete path) also respects a shared storage key", async () => {
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
      const item1 = await createContentItem(server, headers, module.id);
      const item2 = await createContentItem(server, headers, module.id);

      const original = await createReadyAttachment(server, headers, item1.id, recording, "shared-bulk.pdf");
      await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item2.id}/attachments/reuse`,
        headers,
        payload: { sourceAttachmentId: original.id },
      });

      await withTenantDb(tenantId, (db) => deleteAllAttachmentsForEntity(db, "content_item", item1.id));
      expect(recording.deletedKeys).toHaveLength(0); // item2 still references the key

      await withTenantDb(tenantId, (db) => deleteAllAttachmentsForEntity(db, "content_item", item2.id));
      expect(recording.deletedKeys).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("does not delete a platform-shared R2 object when a tenant deletes its cloned attachment, as long as the platform still owns it", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const tenantHeaders = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

    const server = await buildTestServer();
    try {
      const platformCourse = await server.inject({
        method: "POST",
        url: "/admin/platform-courses",
        headers: adminHeaders,
        payload: { title: `Free Course ${randomUUID()}`, categoryName: "Compliance", deliveryMode: "self_paced", duration: { value: 20, unit: "minutes" }, cost: 0 },
      });
      const platformCourseId = platformCourse.json().data.id;
      const platformModule = await server.inject({
        method: "POST",
        url: `/admin/platform-courses/${platformCourseId}/modules`,
        headers: adminHeaders,
        payload: { title: "Module 1" },
      });
      const platformItem = await server.inject({
        method: "POST",
        url: `/admin/platform-course-modules/${platformModule.json().data.id}/content-items`,
        headers: adminHeaders,
        payload: { type: "article", title: "Item 1", payload: { body: "hello" } },
      });
      const platformItemId = platformItem.json().data.id;
      const platformUpload = await server.inject({
        method: "POST",
        url: `/admin/platform-course-content-items/${platformItemId}/attachments`,
        headers: adminHeaders,
        payload: { fileName: "handout.pdf", contentType: "application/pdf", sizeBytes: 512 },
      });
      const platformAttachmentId = platformUpload.json().data.id;
      const platformStorageKey = recording.uploadedKeys[recording.uploadedKeys.length - 1].key;
      recording.simulateUpload(platformStorageKey, 512);
      await server.inject({ method: "POST", url: `/admin/platform-file-attachments/${platformAttachmentId}/confirm`, headers: adminHeaders });
      await server.inject({ method: "PATCH", url: `/admin/platform-courses/${platformCourseId}`, headers: adminHeaders, payload: { status: "active" } });

      const select = await server.inject({ method: "POST", url: `/tenant/course-marketplace/${platformCourseId}/select`, headers: tenantHeaders });
      const clonedCourseId = select.json().data.courseId as string;

      const curriculum = await server.inject({ method: "GET", url: `/tenant/courses/${clonedCourseId}/curriculum`, headers: tenantHeaders });
      const clonedItemId = curriculum.json().data.modules[0].contentItems[0].id;
      const clonedAttachments = await server.inject({ method: "GET", url: `/tenant/content-items/${clonedItemId}/attachments`, headers: tenantHeaders });
      const clonedAttachmentId = clonedAttachments.json().data[0].id;

      const tenantDelete = await server.inject({ method: "DELETE", url: `/tenant/attachments/${clonedAttachmentId}`, headers: tenantHeaders });
      expect(tenantDelete.statusCode).toBe(200);
      // The platform's own platform_file_attachments row still references this exact storage key —
      // deleting the tenant's clone must never take the platform's (or any other tenant's) copy with it.
      expect(recording.deletedKeys).not.toContain(platformStorageKey);

      const platformStillDownloadable = await server.inject({
        method: "GET",
        url: `/admin/platform-file-attachments/${platformAttachmentId}/download-url`,
        headers: adminHeaders,
      });
      expect(platformStillDownloadable.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });
});
