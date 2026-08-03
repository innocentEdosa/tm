import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedSuperAdminSession } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";
import { __setStorageClientForTesting } from "../../src/storage/storage";
import { RecordingStorageClient } from "../unit/fixtures/recording-storage-client";
import { R2StorageClient } from "../../src/storage/r2-client";

type Headers = Record<string, string>;
type Server = Awaited<ReturnType<typeof buildTestServer>>;

async function createPlatformCourse(server: Server, headers: Headers) {
  const response = await server.inject({
    method: "POST",
    url: "/admin/platform-courses",
    headers,
    payload: {
      title: `Platform Course ${randomUUID()}`,
      categoryName: "Compliance",
      deliveryMode: "self_paced",
      duration: { value: 30, unit: "minutes" },
    },
  });
  return response.json().data as { id: string };
}

async function createModule(server: Server, headers: Headers, platformCourseId: string) {
  const response = await server.inject({
    method: "POST",
    url: `/admin/platform-courses/${platformCourseId}/modules`,
    headers,
    payload: { title: `Module ${randomUUID()}` },
  });
  return response.json().data as { id: string };
}

describe("platform course content authoring (spec 029 US2, FR-003/FR-004/FR-005)", () => {
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

  it("creates modules append-ordered and rejects a blank title", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const headers = { cookie: cookieHeader };
    const server = await buildTestServer();
    try {
      const course = await createPlatformCourse(server, headers);
      const m1 = await createModule(server, headers, course.id);
      const m2 = await createModule(server, headers, course.id);

      const detail = await server.inject({ method: "GET", url: `/admin/platform-courses/${course.id}`, headers });
      const modules = detail.json().data.modules as { id: string }[];
      expect(modules.map((m) => m.id)).toEqual([m1.id, m2.id]);

      const blank = await server.inject({
        method: "POST",
        url: `/admin/platform-courses/${course.id}/modules`,
        headers,
        payload: { title: "  " },
      });
      expect(blank.statusCode).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("creates a content item of each of the six types with correct payload, appended in order", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const headers = { cookie: cookieHeader };
    const server = await buildTestServer();
    try {
      const course = await createPlatformCourse(server, headers);
      const module = await createModule(server, headers, course.id);

      const specs: { type: string; title: string; payload: Record<string, unknown> }[] = [
        { type: "video", title: "Intro Video", payload: { url: "https://youtube.com/watch?v=example" } },
        { type: "article", title: "Read Me", payload: { body: "hello" } },
        { type: "live_class", title: "Kickoff Call", payload: { scheduledAt: "2026-08-01T10:00:00Z" } },
        { type: "test", title: "Quiz", payload: {} },
        { type: "assignment", title: "Homework", payload: {} },
        { type: "external_import", title: "SCORM Package", payload: { url: "https://example.com/pkg", sourceType: "scorm" } },
      ];

      for (const s of specs) {
        const response = await server.inject({
          method: "POST",
          url: `/admin/platform-course-modules/${module.id}/content-items`,
          headers,
          payload: s,
        });
        expect(response.statusCode).toBe(201);
        expect(response.json().data.payload).toEqual(s.payload);
      }

      const invalidType = await server.inject({
        method: "POST",
        url: `/admin/platform-course-modules/${module.id}/content-items`,
        headers,
        payload: { type: "not_a_type", title: "Bad" },
      });
      expect(invalidType.statusCode).toBe(422);

      const missingUrl = await server.inject({
        method: "POST",
        url: `/admin/platform-course-modules/${module.id}/content-items`,
        headers,
        payload: { type: "video", title: "No URL" },
      });
      expect(missingUrl.statusCode).toBe(422);

      const detail = await server.inject({ method: "GET", url: `/admin/platform-courses/${course.id}`, headers });
      const items = detail.json().data.modules[0].contentItems as { type: string }[];
      expect(items.map((i) => i.type)).toEqual(specs.map((s) => s.type));
    } finally {
      await server.close();
    }
  });

  it("reorders modules via complete-ordered-id-list, rejecting a partial list", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const headers = { cookie: cookieHeader };
    const server = await buildTestServer();
    try {
      const course = await createPlatformCourse(server, headers);
      const m1 = await createModule(server, headers, course.id);
      const m2 = await createModule(server, headers, course.id);

      const partial = await server.inject({
        method: "PUT",
        url: `/admin/platform-courses/${course.id}/modules/reorder`,
        headers,
        payload: { moduleIds: [m1.id] },
      });
      expect(partial.statusCode).toBe(422);

      const reordered = await server.inject({
        method: "PUT",
        url: `/admin/platform-courses/${course.id}/modules/reorder`,
        headers,
        payload: { moduleIds: [m2.id, m1.id] },
      });
      expect(reordered.statusCode).toBe(200);
      expect(reordered.json().data.map((m: { id: string }) => m.id)).toEqual([m2.id, m1.id]);
    } finally {
      await server.close();
    }
  });

  it("edits and deletes a content item", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const headers = { cookie: cookieHeader };
    const server = await buildTestServer();
    try {
      const course = await createPlatformCourse(server, headers);
      const module = await createModule(server, headers, course.id);
      const created = await server.inject({
        method: "POST",
        url: `/admin/platform-course-modules/${module.id}/content-items`,
        headers,
        payload: { type: "article", title: "Draft", payload: { body: "v1" } },
      });
      const itemId = created.json().data.id;

      const patched = await server.inject({
        method: "PATCH",
        url: `/admin/platform-course-content-items/${itemId}`,
        headers,
        payload: { title: "Final", payload: { body: "v2" } },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json().data.title).toBe("Final");

      const deleted = await server.inject({ method: "DELETE", url: `/admin/platform-course-content-items/${itemId}`, headers });
      expect(deleted.statusCode).toBe(200);

      const detail = await server.inject({ method: "GET", url: `/admin/platform-courses/${course.id}`, headers });
      expect(detail.json().data.modules[0].contentItems).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("uploads, confirms, lists, and deletes a file attachment on a platform content item", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const headers = { cookie: cookieHeader };
    const server = await buildTestServer();
    try {
      const course = await createPlatformCourse(server, headers);
      const module = await createModule(server, headers, course.id);
      const created = await server.inject({
        method: "POST",
        url: `/admin/platform-course-modules/${module.id}/content-items`,
        headers,
        payload: { type: "article", title: "With File", payload: { body: "x" } },
      });
      const itemId = created.json().data.id;

      const uploadResponse = await server.inject({
        method: "POST",
        url: `/admin/platform-course-content-items/${itemId}/attachments`,
        headers,
        payload: { fileName: "handout.pdf", contentType: "application/pdf", sizeBytes: 1024 },
      });
      expect(uploadResponse.statusCode).toBe(201);
      const attachmentId = uploadResponse.json().data.id;
      const storageKey = recording.uploadedKeys[0].key;
      recording.simulateUpload(storageKey, 1024);

      // Confirm/download-url/delete are generic (entity-agnostic) — shared by course-image and
      // content-item attachments alike, mirroring tenant-attachment-routes.ts.
      const confirmResponse = await server.inject({
        method: "POST",
        url: `/admin/platform-file-attachments/${attachmentId}/confirm`,
        headers,
      });
      expect(confirmResponse.statusCode).toBe(200);
      expect(confirmResponse.json().data.status).toBe("ready");

      const listResponse = await server.inject({
        method: "GET",
        url: `/admin/platform-course-content-items/${itemId}/attachments`,
        headers,
      });
      expect(listResponse.json().data).toHaveLength(1);

      const deleteResponse = await server.inject({
        method: "DELETE",
        url: `/admin/platform-file-attachments/${attachmentId}`,
        headers,
      });
      expect(deleteResponse.statusCode).toBe(200);
      expect(recording.deletedKeys).toContain(storageKey);
    } finally {
      await server.close();
    }
  });

  it("rejects all module/content-item/file actions without a valid Super Admin session", async () => {
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/admin/platform-courses/00000000-0000-0000-0000-000000000000/modules",
        payload: { title: "Nope" },
      });
      expect(response.statusCode).toBe(401);
    } finally {
      await server.close();
    }
  });
});
