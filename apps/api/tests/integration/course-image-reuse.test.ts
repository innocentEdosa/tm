import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";
import { __setStorageClientForTesting } from "../../src/storage/storage";
import { RecordingStorageClient } from "../unit/fixtures/recording-storage-client";
import { R2StorageClient } from "../../src/storage/r2-client";

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

/** Uploads + confirms a real course-image attachment via the actual course-image route. */
async function uploadCourseImage(
  server: Server,
  headers: Headers,
  courseId: string,
  recording: RecordingStorageClient,
  fileName = `image-${randomUUID()}.png`,
) {
  const created = await server.inject({
    method: "POST",
    url: `/tenant/courses/${courseId}/image`,
    headers,
    payload: { fileName, contentType: "image/png", sizeBytes: 1000 },
  });
  const data = created.json().data as { id: string };
  const key = recording.uploadedKeys[recording.uploadedKeys.length - 1].key;
  recording.simulateUpload(key, 1000);
  await server.inject({ method: "POST", url: `/tenant/attachments/${data.id}/confirm`, headers });
  return { id: data.id, storageKey: key };
}

describe("course-image picker — reuse an existing tenant image", () => {
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

  it("reuses an existing tenant image as another course's image without a new upload, same storage key", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course1 = await createCourse(server, headers);
      const course2 = await createCourse(server, headers);

      const image = await uploadCourseImage(server, headers, course1.id, recording, "thumbnail.png");
      expect(recording.uploadedKeys).toHaveLength(1);

      const reuse = await server.inject({
        method: "POST",
        url: `/tenant/courses/${course2.id}/image/reuse`,
        headers,
        payload: { sourceAttachmentId: image.id },
      });
      expect(reuse.statusCode).toBe(201);
      expect(reuse.json().data.status).toBe("ready");
      expect(reuse.json().data.fileName).toBe("thumbnail.png");

      // No new R2 upload happened for course2's image.
      expect(recording.uploadedKeys).toHaveLength(1);

      const course2Detail = await server.inject({ method: "GET", url: `/tenant/courses/${course2.id}`, headers });
      expect(course2Detail.json().data.courseImageUrl).toBeTruthy();

      const filesList = await server.inject({ method: "GET", url: "/tenant/files", headers });
      const files = filesList.json().data as { fileName: string; thumbnailUrl: string | null }[];
      // Still one entry — deduped by storage key even though 2 courses now reference it.
      expect(files).toHaveLength(1);
      expect(files[0].thumbnailUrl).toBeTruthy();
    } finally {
      await server.close();
    }
  });

  it("returns 422 reusing a non-image (PDF) attachment as a course image", async () => {
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

      const pdfUpload = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item.id}/attachments`,
        headers,
        payload: { fileName: "handout.pdf", contentType: "application/pdf", sizeBytes: 100 },
      });
      const pdfId = pdfUpload.json().data.id as string;
      const key = recording.uploadedKeys[recording.uploadedKeys.length - 1].key;
      recording.simulateUpload(key, 100);
      await server.inject({ method: "POST", url: `/tenant/attachments/${pdfId}/confirm`, headers });

      const reuse = await server.inject({
        method: "POST",
        url: `/tenant/courses/${course.id}/image/reuse`,
        headers,
        payload: { sourceAttachmentId: pdfId },
      });
      expect(reuse.statusCode).toBe(422);
    } finally {
      await server.close();
    }
  });

  it("returns 404 reusing a cross-tenant image as a course image", async () => {
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
      const otherImage = await uploadCourseImage(server, otherHeaders, otherCourse.id, recording);

      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);

      const reuse = await server.inject({
        method: "POST",
        url: `/tenant/courses/${course.id}/image/reuse`,
        headers,
        payload: { sourceAttachmentId: otherImage.id },
      });
      expect(reuse.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("returns 422 reusing a pending (not yet confirmed) image", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course1 = await createCourse(server, headers);
      const course2 = await createCourse(server, headers);

      const pending = await server.inject({
        method: "POST",
        url: `/tenant/courses/${course1.id}/image`,
        headers,
        payload: { fileName: "not-confirmed.png", contentType: "image/png", sizeBytes: 1000 },
      });

      const reuse = await server.inject({
        method: "POST",
        url: `/tenant/courses/${course2.id}/image/reuse`,
        headers,
        payload: { sourceAttachmentId: pending.json().data.id },
      });
      expect(reuse.statusCode).toBe(422);
    } finally {
      await server.close();
    }
  });

  it("replacing one course's shared image doesn't delete the R2 object while another course still uses it", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course1 = await createCourse(server, headers);
      const course2 = await createCourse(server, headers);

      const shared = await uploadCourseImage(server, headers, course1.id, recording, "shared.png");
      const reuse = await server.inject({
        method: "POST",
        url: `/tenant/courses/${course2.id}/image/reuse`,
        headers,
        payload: { sourceAttachmentId: shared.id },
      });
      expect(reuse.statusCode).toBe(201);

      // course1 replaces its image with a brand-new upload — its old (shared) image attachment row is
      // deleted first (course-image route's existing "only one current image" behavior), but course2's
      // reused row still references the same storage key, so the R2 object must survive.
      await uploadCourseImage(server, headers, course1.id, recording, "new-for-course1.png");
      expect(recording.deletedKeys).toHaveLength(0);

      const course2Detail = await server.inject({ method: "GET", url: `/tenant/courses/${course2.id}`, headers });
      expect(course2Detail.json().data.courseImageUrl).toBeTruthy();

      // Now course2 also replaces its image — the last reference to `shared` is gone, so this time the
      // object must actually be deleted.
      await uploadCourseImage(server, headers, course2.id, recording, "new-for-course2.png");
      expect(recording.deletedKeys).toContain(shared.storageKey);
    } finally {
      await server.close();
    }
  });

  it("returns 403 for a course.view-only caller attempting to reuse a course image", async () => {
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
      const course1 = await createCourse(server, managerHeaders);
      const course2 = await createCourse(server, managerHeaders);
      const image = await uploadCourseImage(server, managerHeaders, course1.id, recording);

      const viewerHeaders = { "x-test-user-id": viewerId, "x-test-tenant-id": tenantId };
      const reuse = await server.inject({
        method: "POST",
        url: `/tenant/courses/${course2.id}/image/reuse`,
        headers: viewerHeaders,
        payload: { sourceAttachmentId: image.id },
      });
      expect(reuse.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
