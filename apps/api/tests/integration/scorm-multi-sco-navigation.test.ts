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

async function importThreeScoPackage(server: Awaited<ReturnType<typeof buildTestServer>>, headers: Headers, contentItemId: string, recording: RecordingStorageClient) {
  const zip = buildTestScormPackage({ itemCount: 3 });
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

async function commitLessonStatus(server: Awaited<ReturnType<typeof buildTestServer>>, headers: Headers, contentItemId: string, lessonStatus: string) {
  return server.inject({ method: "PUT", url: `/tenant/content-items/${contentItemId}/scorm/cmi`, headers, payload: { lessonStatus } });
}

describe("scorm multi-sco navigation and rollup (spec US4, FR-012/FR-013/FR-014)", () => {
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

  it("launch data for any SCO includes all three siblings, correctly ordered", async () => {
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
      const { scos } = await importThreeScoPackage(server, headers, item.id, recording);
      expect(scos).toHaveLength(3);

      for (const sco of scos) {
        const response = await server.inject({ method: "GET", url: `/tenant/content-items/${sco.contentItemId}/scorm/launch`, headers });
        const data = response.json().data;
        expect(data.navigation.scos.map((s: { contentItemId: string }) => s.contentItemId)).toEqual(scos.map((s) => s.contentItemId));
        expect(data.navigation.position).toBe(sco.position);
      }
    } finally {
      await server.close();
    }
  });

  it("packageStatus is not_started, then in_progress, then completed only once all three SCOs are", async () => {
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
      const { scos } = await importThreeScoPackage(server, headers, item.id, recording);

      const initialLaunch = await server.inject({ method: "GET", url: `/tenant/content-items/${scos[0].contentItemId}/scorm/launch`, headers });
      expect(initialLaunch.json().data.navigation.packageStatus).toBe("not_started");

      await commitLessonStatus(server, headers, scos[0].contentItemId, "completed");
      const afterOne = await server.inject({ method: "GET", url: `/tenant/content-items/${scos[0].contentItemId}/scorm/launch`, headers });
      expect(afterOne.json().data.navigation.packageStatus).toBe("in_progress");

      await commitLessonStatus(server, headers, scos[1].contentItemId, "passed");
      const afterTwo = await server.inject({ method: "GET", url: `/tenant/content-items/${scos[0].contentItemId}/scorm/launch`, headers });
      expect(afterTwo.json().data.navigation.packageStatus).toBe("in_progress");

      await commitLessonStatus(server, headers, scos[2].contentItemId, "completed");
      const afterAll = await server.inject({ method: "GET", url: `/tenant/content-items/${scos[0].contentItemId}/scorm/launch`, headers });
      expect(afterAll.json().data.navigation.packageStatus).toBe("completed");
    } finally {
      await server.close();
    }
  });

  it("never locks navigation to any SCO regardless of another SCO's completion state", async () => {
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
      const { scos } = await importThreeScoPackage(server, headers, item.id, recording);

      // Leave scos[0] untouched, jump straight to the last SCO — must be reachable regardless.
      const response = await server.inject({ method: "GET", url: `/tenant/content-items/${scos[2].contentItemId}/scorm/launch`, headers });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.navigation.scos).toHaveLength(3);
    } finally {
      await server.close();
    }
  });
});
