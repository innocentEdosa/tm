import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

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

async function createItem(server: Awaited<ReturnType<typeof buildTestServer>>, headers: Headers, moduleId: string) {
  const response = await server.inject({
    method: "POST",
    url: `/tenant/modules/${moduleId}/content-items`,
    headers,
    payload: { type: "article", title: `Item ${randomUUID()}`, payload: { body: "text" } },
  });
  return response.json().data as { id: string };
}

describe("delete and cascade (spec US5, FR-009/FR-011)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("deletes a content item, removing it from a subsequent curriculum read", async () => {
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
      const item = await createItem(server, headers, module.id);

      const response = await server.inject({ method: "DELETE", url: `/tenant/content-items/${item.id}`, headers });
      expect(response.statusCode).toBe(200);

      const curriculum = await server.inject({ method: "GET", url: `/tenant/courses/${course.id}/curriculum`, headers });
      expect(curriculum.json().data[0].contentItems).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("deletes a module, cascading to remove every content item it held (not orphaned)", async () => {
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
      const item1 = await createItem(server, headers, module.id);
      const item2 = await createItem(server, headers, module.id);

      const response = await server.inject({ method: "DELETE", url: `/tenant/modules/${module.id}`, headers });
      expect(response.statusCode).toBe(200);

      const curriculum = await server.inject({ method: "GET", url: `/tenant/courses/${course.id}/curriculum`, headers });
      expect(curriculum.json().data).toEqual([]);

      const itemStillFetchable = await server.inject({ method: "PATCH", url: `/tenant/content-items/${item1.id}`, headers, payload: { title: "still here?" } });
      expect(itemStillFetchable.statusCode).toBe(404);
      const item2StillFetchable = await server.inject({ method: "PATCH", url: `/tenant/content-items/${item2.id}`, headers, payload: { title: "still here?" } });
      expect(item2StillFetchable.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("returns 404 for a delete targeting a cross-tenant module or content item id", async () => {
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
      const otherItem = await createItem(server, otherHeaders, otherModule.id);

      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const deleteItem = await server.inject({ method: "DELETE", url: `/tenant/content-items/${otherItem.id}`, headers });
      expect(deleteItem.statusCode).toBe(404);
      const deleteModule = await server.inject({ method: "DELETE", url: `/tenant/modules/${otherModule.id}`, headers });
      expect(deleteModule.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("returns 403 for a course.view-only caller attempting to delete", async () => {
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
      const item = await createItem(server, managerHeaders, module.id);

      const viewerHeaders = { "x-test-user-id": viewerId, "x-test-tenant-id": tenantId };
      const deleteItem = await server.inject({ method: "DELETE", url: `/tenant/content-items/${item.id}`, headers: viewerHeaders });
      expect(deleteItem.statusCode).toBe(403);
      const deleteModule = await server.inject({ method: "DELETE", url: `/tenant/modules/${module.id}`, headers: viewerHeaders });
      expect(deleteModule.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
