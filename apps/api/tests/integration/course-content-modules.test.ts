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

describe("course module create (spec US1, FR-001/FR-010/FR-011/FR-012)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("creates modules appended in sequential order with audit fields recorded", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);

      const first = await server.inject({
        method: "POST",
        url: `/tenant/courses/${course.id}/modules`,
        headers,
        payload: { title: "Module 1: Introduction" },
      });
      expect(first.statusCode).toBe(201);
      expect(first.json().data.createdBy.id).toBe(userId);
      expect(first.json().data.contentItems).toEqual([]);

      const second = await server.inject({
        method: "POST",
        url: `/tenant/courses/${course.id}/modules`,
        headers,
        payload: { title: "Module 2: Advanced" },
      });
      expect(second.statusCode).toBe(201);

      const curriculum = await server.inject({ method: "GET", url: `/tenant/courses/${course.id}/curriculum`, headers });
      const titles = curriculum.json().data.map((m: { title: string }) => m.title);
      expect(titles).toEqual(["Module 1: Introduction", "Module 2: Advanced"]);
    } finally {
      await server.close();
    }
  });

  it("rejects a create request missing a title", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);

      const response = await server.inject({ method: "POST", url: `/tenant/courses/${course.id}/modules`, headers, payload: {} });
      expect(response.statusCode).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("returns 404 for a create request targeting a course id that doesn't resolve in the caller's tenant", async () => {
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

      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const response = await server.inject({ method: "POST", url: `/tenant/courses/${otherCourse.id}/modules`, headers, payload: { title: "X" } });
      expect(response.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("returns 403 for a course.view-only caller attempting to create a module", async () => {
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

      const viewerHeaders = { "x-test-user-id": viewerId, "x-test-tenant-id": tenantId };
      const response = await server.inject({ method: "POST", url: `/tenant/courses/${course.id}/modules`, headers: viewerHeaders, payload: { title: "X" } });
      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
