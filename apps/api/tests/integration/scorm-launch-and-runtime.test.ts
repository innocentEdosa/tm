import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";
import { __setStorageClientForTesting } from "../../src/storage/storage";
import { RecordingStorageClient } from "../unit/fixtures/recording-storage-client";
import { R2StorageClient } from "../../src/storage/r2-client";
import { buildTestScormPackage } from "../unit/fixtures/build-test-scorm-package";

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

async function createScormContentItem(server: Awaited<ReturnType<typeof buildTestServer>>, headers: Headers, moduleId: string) {
  const response = await server.inject({
    method: "POST",
    url: `/tenant/modules/${moduleId}/content-items`,
    headers,
    payload: { type: "external_import", title: `SCORM Item ${randomUUID()}`, payload: { sourceType: "scorm", url: "n/a" } },
  });
  return response.json().data as { id: string };
}

async function importPackage(
  server: Awaited<ReturnType<typeof buildTestServer>>,
  headers: Headers,
  contentItemId: string,
  recording: RecordingStorageClient,
  itemCount = 1,
) {
  const zip = buildTestScormPackage({ itemCount });
  const uploadUrlResponse = await server.inject({
    method: "POST",
    url: `/tenant/content-items/${contentItemId}/scorm/upload-url`,
    headers,
    payload: { sizeBytes: zip.length },
  });
  const { storageKey } = uploadUrlResponse.json().data as { storageKey: string };
  recording.simulateUpload(storageKey, zip.length, zip);

  const importResponse = await server.inject({
    method: "POST",
    url: `/tenant/content-items/${contentItemId}/scorm/import`,
    headers,
    payload: { storageKey },
  });
  return importResponse.json().data as { packageId: string; scos: { contentItemId: string; title: string; position: number }[] };
}

describe("scorm launch and runtime (spec US2/US3, FR-005..FR-011)", () => {
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

  it("returns launch data for an untouched SCO (ab-initio, empty objectives/interactions)", async () => {
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
      const item = await createScormContentItem(server, headers, module.id);
      await importPackage(server, headers, item.id, recording);

      const response = await server.inject({ method: "GET", url: `/tenant/content-items/${item.id}/scorm/launch`, headers });
      expect(response.statusCode).toBe(200);
      const data = response.json().data;
      expect(data.cmi.entry).toBe("ab-initio");
      expect(data.cmi.lessonStatus).toBe("not attempted");
      expect(data.cmi.objectives).toEqual([]);
      expect(data.cmi.interactions).toEqual([]);
      expect(data.entryPointUrl).toContain("sco1/index.html");
    } finally {
      await server.close();
    }
  });

  it("serves the entry point and a relative asset through the file proxy with correct Content-Type", async () => {
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
      const item = await createScormContentItem(server, headers, module.id);
      const { packageId } = await importPackage(server, headers, item.id, recording);

      const html = await server.inject({ method: "GET", url: `/tenant/scorm/packages/${packageId}/files/sco1/index.html`, headers });
      expect(html.statusCode).toBe(200);
      expect(html.headers["content-type"]).toContain("text/html");

      const css = await server.inject({ method: "GET", url: `/tenant/scorm/packages/${packageId}/files/sco1/style.css`, headers });
      expect(css.statusCode).toBe(200);
      expect(css.headers["content-type"]).toContain("text/css");
    } finally {
      await server.close();
    }
  });

  it("returns 404 for a nonexistent relative path", async () => {
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
      const item = await createScormContentItem(server, headers, module.id);
      const { packageId } = await importPackage(server, headers, item.id, recording);

      const response = await server.inject({ method: "GET", url: `/tenant/scorm/packages/${packageId}/files/does/not/exist.html`, headers });
      expect(response.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("returns 404 for cross-tenant/nonexistent contentItemId and packageId", async () => {
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
      const otherItem = await createScormContentItem(server, otherHeaders, otherModule.id);
      const { packageId } = await importPackage(server, otherHeaders, otherItem.id, recording);

      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const launchResponse = await server.inject({ method: "GET", url: `/tenant/content-items/${otherItem.id}/scorm/launch`, headers });
      expect(launchResponse.statusCode).toBe(404);

      const fileResponse = await server.inject({ method: "GET", url: `/tenant/scorm/packages/${packageId}/files/sco1/index.html`, headers });
      expect(fileResponse.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("returns 403 for a caller holding neither course.view nor course.manage on both launch and file-proxy", async () => {
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
      const item = await createScormContentItem(server, managerHeaders, module.id);
      const { packageId } = await importPackage(server, managerHeaders, item.id, recording);

      const noPermHeaders = { "x-test-user-id": noPermId, "x-test-tenant-id": tenantId };
      const launchResponse = await server.inject({ method: "GET", url: `/tenant/content-items/${item.id}/scorm/launch`, headers: noPermHeaders });
      expect(launchResponse.statusCode).toBe(403);

      const fileResponse = await server.inject({ method: "GET", url: `/tenant/scorm/packages/${packageId}/files/sco1/index.html`, headers: noPermHeaders });
      expect(fileResponse.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("commit then relaunch shows resume with every field round-tripped (spec US3)", async () => {
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
      const item = await createScormContentItem(server, headers, module.id);
      await importPackage(server, headers, item.id, recording);

      const commitResponse = await server.inject({
        method: "PUT",
        url: `/tenant/content-items/${item.id}/scorm/cmi`,
        headers,
        payload: {
          lessonStatus: "passed",
          scoreRaw: 92,
          scoreMin: 0,
          scoreMax: 100,
          bookmark: "page-4",
          suspendData: "state-blob",
          sessionTimeSeconds: 200,
          objectives: [{ objectiveId: "obj-1", status: "passed", scoreRaw: 95 }],
          interactions: [{ interactionId: "q1", type: "choice", studentResponse: "b", result: "correct" }],
        },
      });
      expect(commitResponse.statusCode).toBe(200);

      const relaunch = await server.inject({ method: "GET", url: `/tenant/content-items/${item.id}/scorm/launch`, headers });
      expect(relaunch.statusCode).toBe(200);
      const data = relaunch.json().data;
      expect(data.cmi.entry).toBe("resume");
      expect(data.cmi.lessonStatus).toBe("passed");
      expect(data.cmi.scoreRaw).toBe(92);
      expect(data.cmi.bookmark).toBe("page-4");
      expect(data.cmi.suspendData).toBe("state-blob");
      expect(data.cmi.totalTimeSeconds).toBe(200);
      expect(data.cmi.objectives).toHaveLength(1);
      expect(data.cmi.objectives[0]).toMatchObject({ objectiveId: "obj-1", status: "passed", scoreRaw: 95 });
      expect(data.cmi.interactions).toHaveLength(1);
      expect(data.cmi.interactions[0]).toMatchObject({ interactionId: "q1", type: "choice", studentResponse: "b", result: "correct" });
    } finally {
      await server.close();
    }
  });

  it("rejects suspendData exceeding 4096 characters with no partial write", async () => {
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
      const item = await createScormContentItem(server, headers, module.id);
      await importPackage(server, headers, item.id, recording);

      const response = await server.inject({
        method: "PUT",
        url: `/tenant/content-items/${item.id}/scorm/cmi`,
        headers,
        payload: { lessonStatus: "incomplete", suspendData: "x".repeat(4097) },
      });
      expect(response.statusCode).toBe(400);

      const launch = await server.inject({ method: "GET", url: `/tenant/content-items/${item.id}/scorm/launch`, headers });
      expect(launch.json().data.cmi.entry).toBe("ab-initio");
    } finally {
      await server.close();
    }
  });

  it("replaces (not appends) objectives/interactions arrays on a second commit", async () => {
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
      const item = await createScormContentItem(server, headers, module.id);
      await importPackage(server, headers, item.id, recording);

      await server.inject({
        method: "PUT",
        url: `/tenant/content-items/${item.id}/scorm/cmi`,
        headers,
        payload: { lessonStatus: "incomplete", objectives: [{ objectiveId: "obj-1" }, { objectiveId: "obj-2" }] },
      });
      await server.inject({
        method: "PUT",
        url: `/tenant/content-items/${item.id}/scorm/cmi`,
        headers,
        payload: { lessonStatus: "incomplete", objectives: [{ objectiveId: "obj-only" }] },
      });

      const launch = await server.inject({ method: "GET", url: `/tenant/content-items/${item.id}/scorm/launch`, headers });
      expect(launch.json().data.cmi.objectives).toHaveLength(1);
      expect(launch.json().data.cmi.objectives[0].objectiveId).toBe("obj-only");
    } finally {
      await server.close();
    }
  });
});
