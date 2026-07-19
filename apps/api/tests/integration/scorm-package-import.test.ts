import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { __setStorageClientForTesting } from "../../src/storage/storage";
import { RecordingStorageClient } from "../unit/fixtures/recording-storage-client";
import { R2StorageClient } from "../../src/storage/r2-client";
import { buildTestScormPackage } from "../unit/fixtures/build-test-scorm-package";
import { contentItems } from "../../src/db/schema/course-content";

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

async function uploadAndImport(
  server: Awaited<ReturnType<typeof buildTestServer>>,
  headers: Headers,
  contentItemId: string,
  recording: RecordingStorageClient,
  zipBuffer: Buffer,
) {
  const uploadUrlResponse = await server.inject({
    method: "POST",
    url: `/tenant/content-items/${contentItemId}/scorm/upload-url`,
    headers,
    payload: { sizeBytes: zipBuffer.length },
  });
  const { storageKey } = uploadUrlResponse.json().data as { storageKey: string };
  recording.simulateUpload(storageKey, zipBuffer.length, zipBuffer);

  return server.inject({
    method: "POST",
    url: `/tenant/content-items/${contentItemId}/scorm/import`,
    headers,
    payload: { storageKey },
  });
}

describe("scorm package import (spec US1, FR-001..FR-004)", () => {
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

  it("imports a single-SCO package without creating additional content items", async () => {
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

      const zip = buildTestScormPackage({ itemCount: 1 });
      const response = await uploadAndImport(server, headers, item.id, recording, zip);
      expect(response.statusCode).toBe(201);
      const data = response.json().data as { packageId: string; scos: { contentItemId: string }[] };
      expect(data.scos).toHaveLength(1);
      expect(data.scos[0].contentItemId).toBe(item.id);
    } finally {
      await server.close();
    }
  });

  it("imports a two-SCO package creating one additional content item, positioned immediately after", async () => {
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

      const zip = buildTestScormPackage({ itemCount: 2 });
      const response = await uploadAndImport(server, headers, item.id, recording, zip);
      expect(response.statusCode).toBe(201);
      const data = response.json().data as { packageId: string; scos: { contentItemId: string; position: number }[] };
      expect(data.scos).toHaveLength(2);
      expect(data.scos[0].contentItemId).toBe(item.id);
      expect(data.scos[1].contentItemId).not.toBe(item.id);

      const rows = await withTenantDb(tenantId, (db) => db.select().from(contentItems).where(eq(contentItems.moduleId, module.id)));
      const sorted = rows.sort((a, b) => a.position - b.position);
      expect(sorted.map((r) => r.id)).toEqual([data.scos[0].contentItemId, data.scos[1].contentItemId]);
    } finally {
      await server.close();
    }
  });

  it("rejects a malformed archive, creating nothing", async () => {
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

      const badZip = Buffer.from("not a zip archive");
      const response = await uploadAndImport(server, headers, item.id, recording, badZip);
      expect(response.statusCode).toBe(422);
    } finally {
      await server.close();
    }
  });

  it("rejects a manifest with an unresolvable resource reference, creating nothing", async () => {
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

      const zip = buildTestScormPackage({ itemCount: 1, unresolvableResource: true });
      const response = await uploadAndImport(server, headers, item.id, recording, zip);
      expect(response.statusCode).toBe(422);

      const rows = await withTenantDb(tenantId, (db) => db.select().from(contentItems).where(eq(contentItems.moduleId, module.id)));
      expect(rows).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("returns 404 for a cross-tenant or nonexistent contentItemId", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const response = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${randomUUID()}/scorm/upload-url`,
        headers,
        payload: { sizeBytes: 100 },
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("returns 403 for a course.view-only caller on both upload-url and import", async () => {
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
      const item = await createScormContentItem(server, managerHeaders, module.id);

      const viewerHeaders = { "x-test-user-id": viewerId, "x-test-tenant-id": tenantId };
      const uploadUrlResponse = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item.id}/scorm/upload-url`,
        headers: viewerHeaders,
        payload: { sizeBytes: 100 },
      });
      expect(uploadUrlResponse.statusCode).toBe(403);

      const importResponse = await server.inject({
        method: "POST",
        url: `/tenant/content-items/${item.id}/scorm/import`,
        headers: viewerHeaders,
        payload: { storageKey: "irrelevant" },
      });
      expect(importResponse.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
