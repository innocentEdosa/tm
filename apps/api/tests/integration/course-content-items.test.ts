import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

async function createCourse(server: Awaited<ReturnType<typeof buildTestServer>>, headers: Record<string, string>) {
  const response = await server.inject({
    method: "POST",
    url: "/tenant/courses",
    headers,
    payload: {
      title: `Course ${randomUUID()}`,
      category: "Technical",
      deliveryMode: "virtual",
      duration: { value: 1, unit: "hours" },
    },
  });
  return response.json().data as { id: string };
}

async function createModule(server: Awaited<ReturnType<typeof buildTestServer>>, headers: Record<string, string>, courseId: string) {
  const response = await server.inject({ method: "POST", url: `/tenant/courses/${courseId}/modules`, headers, payload: { title: `Module ${randomUUID()}` } });
  return response.json().data as { id: string };
}

describe("content item create (spec US2, FR-003/FR-004/FR-005/FR-011/FR-012)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("creates one content item of each of the six types with correct payload", async () => {
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

      const cases: { type: string; title: string; payload: Record<string, unknown> }[] = [
        { type: "video", title: "Welcome Video", payload: { url: "https://youtube.com/watch?v=example" } },
        { type: "article", title: "Read Me", payload: { body: "Welcome..." } },
        { type: "live_class", title: "Kickoff Call", payload: { scheduledAt: "2026-08-01T10:00:00Z", facilitator: "Jo", capacity: 20 } },
        { type: "test", title: "Module Quiz", payload: { passCriteria: "80% required" } },
        { type: "assignment", title: "Homework 1", payload: {} },
        { type: "external_import", title: "Legacy SCORM", payload: { url: "https://cdn.example.com/pkg.zip", sourceType: "scorm" } },
      ];

      for (const c of cases) {
        const response = await server.inject({ method: "POST", url: `/tenant/modules/${module.id}/content-items`, headers, payload: c });
        expect(response.statusCode).toBe(201);
        const body = response.json().data;
        expect(body.type).toBe(c.type);
        expect(body.payload).toEqual(c.payload);
        expect(body.createdBy.id).toBe(userId);
      }

      const curriculum = await server.inject({ method: "GET", url: `/tenant/courses/${course.id}/curriculum`, headers });
      const items = curriculum.json().data[0].contentItems;
      expect(items.map((i: { title: string }) => i.title)).toEqual(cases.map((c) => c.title));
    } finally {
      await server.close();
    }
  });

  it("rejects an invalid type", async () => {
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

      const response = await server.inject({
        method: "POST",
        url: `/tenant/modules/${module.id}/content-items`,
        headers,
        payload: { type: "podcast", title: "X" },
      });
      expect(response.statusCode).toBe(422);
    } finally {
      await server.close();
    }
  });

  it("rejects a video missing payload.url, and an external_import missing payload.sourceType", async () => {
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

      const badVideo = await server.inject({ method: "POST", url: `/tenant/modules/${module.id}/content-items`, headers, payload: { type: "video", title: "X", payload: {} } });
      expect(badVideo.statusCode).toBe(422);

      const badImport = await server.inject({
        method: "POST",
        url: `/tenant/modules/${module.id}/content-items`,
        headers,
        payload: { type: "external_import", title: "X", payload: { url: "https://example.com/x.zip" } },
      });
      expect(badImport.statusCode).toBe(422);

      const badArticle = await server.inject({
        method: "POST",
        url: `/tenant/modules/${module.id}/content-items`,
        headers,
        payload: { type: "article", title: "X", payload: {} },
      });
      expect(badArticle.statusCode).toBe(422);
    } finally {
      await server.close();
    }
  });

  it("returns 404 for a create request targeting a module id that doesn't resolve in the caller's tenant", async () => {
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

      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const response = await server.inject({
        method: "POST",
        url: `/tenant/modules/${otherModule.id}/content-items`,
        headers,
        payload: { type: "video", title: "X", payload: { url: "https://example.com" } },
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("returns 403 for a course.view-only caller attempting to create a content item", async () => {
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

      const viewerHeaders = { "x-test-user-id": viewerId, "x-test-tenant-id": tenantId };
      const response = await server.inject({
        method: "POST",
        url: `/tenant/modules/${module.id}/content-items`,
        headers: viewerHeaders,
        payload: { type: "video", title: "X", payload: { url: "https://example.com" } },
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
