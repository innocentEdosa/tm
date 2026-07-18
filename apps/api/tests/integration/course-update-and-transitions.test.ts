import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

async function createCourse(
  server: Awaited<ReturnType<typeof buildTestServer>>,
  headers: Record<string, string>,
  overrides: Record<string, unknown> = {},
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
      ...overrides,
    },
  });
  return response.json().data as { id: string; status: string; updatedAt: string };
}

describe("course update + status transitions (spec US3, FR-005/FR-007/FR-008/FR-009/FR-010)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("updates fields and refreshes updatedBy/updatedAt", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const created = await createCourse(server, headers);

      const response = await server.inject({
        method: "PATCH",
        url: `/tenant/courses/${created.id}`,
        headers,
        payload: { status: "active", cost: 39.99 },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json().data;
      expect(body.status).toBe("active");
      expect(body.cost).toBe(39.99);
      expect(body.updatedBy.id).toBe(userId);
    } finally {
      await server.close();
    }
  });

  it("rejects an invalid enum value with no partial update", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const created = await createCourse(server, headers, { title: "Unchanged Title" });

      const response = await server.inject({
        method: "PATCH",
        url: `/tenant/courses/${created.id}`,
        headers,
        payload: { title: "Should Not Save", deliveryMode: "carrier_pigeon" },
      });
      expect(response.statusCode).toBe(422);

      const refetch = await server.inject({ method: "GET", url: `/tenant/courses/${created.id}`, headers });
      expect(refetch.json().data.title).toBe("Unchanged Title");
    } finally {
      await server.close();
    }
  });

  it("returns 403 for a course.view-only caller attempting to update", async () => {
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
      const response = await server.inject({
        method: "PATCH",
        url: `/tenant/courses/${created.id}`,
        headers: viewerHeaders,
        payload: { title: "Nope" },
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("returns 404 for an update targeting a cross-tenant course id", async () => {
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
      const created = await createCourse(server, headers);

      const otherHeaders = { "x-test-user-id": otherUserId, "x-test-tenant-id": otherTenantId };
      const response = await server.inject({
        method: "PATCH",
        url: `/tenant/courses/${created.id}`,
        headers: otherHeaders,
        payload: { title: "Hijacked" },
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("un-archives a course (archived -> active) via a plain PATCH, not a separate action", async () => {
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
      expect(archived.json().data.status).toBe("archived");

      const unarchived = await server.inject({
        method: "PATCH",
        url: `/tenant/courses/${created.id}`,
        headers,
        payload: { status: "active" },
      });
      expect(unarchived.statusCode).toBe(200);
      expect(unarchived.json().data.status).toBe("active");
    } finally {
      await server.close();
    }
  });
});
