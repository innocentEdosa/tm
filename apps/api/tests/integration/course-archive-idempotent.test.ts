import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

async function createCourse(
  server: Awaited<ReturnType<typeof buildTestServer>>,
  headers: Record<string, string>,
) {
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
  return response.json().data as { id: string; status: string };
}

describe("course archive (spec US4, FR-006/FR-008/FR-011)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("excludes an archived course from the default list but keeps it retrievable by id and via an explicit filter", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const created = await createCourse(server, headers);

      const archived = await server.inject({ method: "POST", url: `/tenant/courses/${created.id}/archive`, headers });
      expect(archived.statusCode).toBe(200);
      expect(archived.json().data.status).toBe("archived");

      const defaultList = await server.inject({ method: "GET", url: "/tenant/courses", headers });
      expect(defaultList.json().data.map((c: { id: string }) => c.id)).not.toContain(created.id);

      const byId = await server.inject({ method: "GET", url: `/tenant/courses/${created.id}`, headers });
      expect(byId.statusCode).toBe(200);
      expect(byId.json().data.status).toBe("archived");

      const archivedFilter = await server.inject({ method: "GET", url: "/tenant/courses?status=archived", headers });
      expect(archivedFilter.json().data.map((c: { id: string }) => c.id)).toContain(created.id);
    } finally {
      await server.close();
    }
  });

  it("succeeds idempotently when archiving an already-archived course", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const created = await createCourse(server, headers);

      const first = await server.inject({ method: "POST", url: `/tenant/courses/${created.id}/archive`, headers });
      expect(first.statusCode).toBe(200);

      const second = await server.inject({ method: "POST", url: `/tenant/courses/${created.id}/archive`, headers });
      expect(second.statusCode).toBe(200);
      expect(second.json().data.status).toBe("archived");
    } finally {
      await server.close();
    }
  });

  it("returns 403 for a course.view-only caller attempting to archive", async () => {
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
      const created = await createCourse(server, managerHeaders);

      const viewerHeaders = { "x-test-user-id": viewerId, "x-test-tenant-id": tenantId };
      const response = await server.inject({ method: "POST", url: `/tenant/courses/${created.id}/archive`, headers: viewerHeaders });
      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
