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
    payload: { title: `Course ${randomUUID()}`, category: "Technical", deliveryMode: "virtual", duration: { value: 1, unit: "hours" } },
  });
  return response.json().data as { id: string };
}

describe("curriculum read (spec US3, FR-002/FR-010/FR-011)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns every module and content item in order, correctly nested", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.view", "course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);

      const mod1 = (await server.inject({ method: "POST", url: `/tenant/courses/${course.id}/modules`, headers, payload: { title: "Module 1" } })).json().data;
      const mod2 = (await server.inject({ method: "POST", url: `/tenant/courses/${course.id}/modules`, headers, payload: { title: "Module 2" } })).json().data;

      await server.inject({ method: "POST", url: `/tenant/modules/${mod1.id}/content-items`, headers, payload: { type: "video", title: "V1", payload: { url: "https://x.com" } } });
      await server.inject({ method: "POST", url: `/tenant/modules/${mod1.id}/content-items`, headers, payload: { type: "article", title: "A1", payload: { body: "text" } } });
      await server.inject({ method: "POST", url: `/tenant/modules/${mod2.id}/content-items`, headers, payload: { type: "assignment", title: "HW1", payload: {} } });

      const response = await server.inject({ method: "GET", url: `/tenant/courses/${course.id}/curriculum`, headers });
      expect(response.statusCode).toBe(200);
      const data = response.json().data;
      expect(data).toHaveLength(2);
      expect(data[0].title).toBe("Module 1");
      expect(data[0].contentItems.map((i: { title: string }) => i.title)).toEqual(["V1", "A1"]);
      expect(data[1].title).toBe("Module 2");
      expect(data[1].contentItems.map((i: { title: string }) => i.title)).toEqual(["HW1"]);
    } finally {
      await server.close();
    }
  });

  it("returns an empty list for a course with zero modules", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.view", "course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);

      const response = await server.inject({ method: "GET", url: `/tenant/courses/${course.id}/curriculum`, headers });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("returns 404 for a cross-tenant course id", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const otherTenantId = randomUUID();
    await seedTenant(otherTenantId);
    const otherUserId = randomUUID();
    await seedUser(otherTenantId, otherUserId);
    await seedUserWithRole(otherTenantId, otherUserId, ["course.view"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);

      const otherHeaders = { "x-test-user-id": otherUserId, "x-test-tenant-id": otherTenantId };
      const response = await server.inject({ method: "GET", url: `/tenant/courses/${course.id}/curriculum`, headers: otherHeaders });
      expect(response.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("returns 403 for a caller holding neither course.view nor course.manage", async () => {
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

      const noPermHeaders = { "x-test-user-id": noPermId, "x-test-tenant-id": tenantId };
      const response = await server.inject({ method: "GET", url: `/tenant/courses/${course.id}/curriculum`, headers: noPermHeaders });
      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
