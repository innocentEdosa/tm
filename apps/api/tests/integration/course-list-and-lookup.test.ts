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
  return response.json().data as { id: string; title: string; status: string };
}

describe("course list + lookup (spec US2, FR-002/FR-003/FR-004/FR-007/FR-008)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("excludes archived courses from the default list, includes them with an explicit status filter", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const active = await createCourse(server, headers, { title: "Active Course" });
      const toArchive = await createCourse(server, headers, { title: "Soon Archived" });

      await server.inject({ method: "POST", url: `/tenant/courses/${toArchive.id}/archive`, headers });

      const defaultList = await server.inject({ method: "GET", url: "/tenant/courses", headers });
      const defaultIds = defaultList.json().data.map((c: { id: string }) => c.id);
      expect(defaultIds).toContain(active.id);
      expect(defaultIds).not.toContain(toArchive.id);

      const archivedList = await server.inject({ method: "GET", url: "/tenant/courses?status=archived", headers });
      const archivedIds = archivedList.json().data.map((c: { id: string }) => c.id);
      expect(archivedIds).toContain(toArchive.id);
    } finally {
      await server.close();
    }
  });

  it("supports title search and deliveryMode filter", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.view", "course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const unique = randomUUID().slice(0, 8);
      await createCourse(server, headers, { title: `Zebra Onboarding ${unique}`, deliveryMode: "self_paced" });
      await createCourse(server, headers, { title: "Unrelated Course", deliveryMode: "virtual" });

      const search = await server.inject({
        method: "GET",
        url: `/tenant/courses?search=${encodeURIComponent(`Zebra Onboarding ${unique}`)}`,
        headers,
      });
      const searchTitles = search.json().data.map((c: { title: string }) => c.title);
      expect(searchTitles).toEqual([`Zebra Onboarding ${unique}`]);

      const filtered = await server.inject({ method: "GET", url: "/tenant/courses?deliveryMode=self_paced", headers });
      const filteredTitles = filtered.json().data.map((c: { title: string }) => c.title);
      expect(filteredTitles).toContain(`Zebra Onboarding ${unique}`);
      expect(filteredTitles).not.toContain("Unrelated Course");
    } finally {
      await server.close();
    }
  });

  it("returns an empty list for a tenant with zero courses", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.view"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const response = await server.inject({ method: "GET", url: "/tenant/courses", headers });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("gets a course by id, and returns 404 for a cross-tenant id", async () => {
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
      const created = await createCourse(server, headers, { title: "Findable Course" });

      const found = await server.inject({ method: "GET", url: `/tenant/courses/${created.id}`, headers });
      expect(found.statusCode).toBe(200);
      expect(found.json().data.title).toBe("Findable Course");

      const otherHeaders = { "x-test-user-id": otherUserId, "x-test-tenant-id": otherTenantId };
      const crossTenant = await server.inject({ method: "GET", url: `/tenant/courses/${created.id}`, headers: otherHeaders });
      expect(crossTenant.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("returns 403 for a caller holding neither course.view nor course.manage", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, []);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const response = await server.inject({ method: "GET", url: "/tenant/courses", headers });
      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
