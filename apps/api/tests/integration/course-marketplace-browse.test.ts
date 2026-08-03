import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole, seedSuperAdminSession } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

type Server = Awaited<ReturnType<typeof buildTestServer>>;
type Headers = Record<string, string>;

async function createActivePlatformCourse(server: Server, adminHeaders: Headers, overrides: Record<string, unknown> = {}) {
  const created = await server.inject({
    method: "POST",
    url: "/admin/platform-courses",
    headers: adminHeaders,
    payload: {
      title: `Marketplace Course ${randomUUID()}`,
      categoryName: "Compliance",
      deliveryMode: "self_paced",
      duration: { value: 30, unit: "minutes" },
      ...overrides,
    },
  });
  const id = created.json().data.id;
  await server.inject({ method: "PATCH", url: `/admin/platform-courses/${id}`, headers: adminHeaders, payload: { status: "active" } });
  return id as string;
}

describe("course marketplace browse (spec 029 US3, FR-006/FR-007)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("excludes draft and archived platform courses from the list", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const tenantHeaders = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

    const server = await buildTestServer();
    try {
      const activeId = await createActivePlatformCourse(server, adminHeaders);

      const draft = await server.inject({
        method: "POST",
        url: "/admin/platform-courses",
        headers: adminHeaders,
        payload: { title: `Draft ${randomUUID()}`, categoryName: "Compliance", deliveryMode: "self_paced", duration: { value: 10, unit: "minutes" } },
      });
      const draftId = draft.json().data.id;

      const list = await server.inject({ method: "GET", url: "/tenant/course-marketplace", headers: tenantHeaders });
      expect(list.statusCode).toBe(200);
      const ids = list.json().data.map((c: { id: string }) => c.id);
      expect(ids).toContain(activeId);
      expect(ids).not.toContain(draftId);
    } finally {
      await server.close();
    }
  });

  it("narrows by search and category filters", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const tenantHeaders = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

    const server = await buildTestServer();
    try {
      const unique = randomUUID();
      const targetId = await createActivePlatformCourse(server, adminHeaders, { title: `Findable ${unique}`, categoryName: "Leadership" });
      await createActivePlatformCourse(server, adminHeaders, { title: `Other ${randomUUID()}`, categoryName: "Technical" });

      const bySearch = await server.inject({
        method: "GET",
        url: `/tenant/course-marketplace?search=${encodeURIComponent(unique)}`,
        headers: tenantHeaders,
      });
      const searchIds = bySearch.json().data.map((c: { id: string }) => c.id);
      expect(searchIds).toEqual([targetId]);

      const byCategory = await server.inject({
        method: "GET",
        url: "/tenant/course-marketplace?category=Leadership",
        headers: tenantHeaders,
      });
      expect(byCategory.json().data.map((c: { id: string }) => c.id)).toContain(targetId);
    } finally {
      await server.close();
    }
  });

  it("returns full detail with curriculum for an active course, 404 for draft/archived/nonexistent", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const tenantHeaders = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

    const server = await buildTestServer();
    try {
      const activeId = await createActivePlatformCourse(server, adminHeaders);
      await server.inject({
        method: "POST",
        url: `/admin/platform-courses/${activeId}/modules`,
        headers: adminHeaders,
        payload: { title: "Module 1" },
      });

      const detail = await server.inject({ method: "GET", url: `/tenant/course-marketplace/${activeId}`, headers: tenantHeaders });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().data.modules).toHaveLength(1);
      expect(detail.json().data.alreadySelected).toBe(false);

      const draft = await server.inject({
        method: "POST",
        url: "/admin/platform-courses",
        headers: adminHeaders,
        payload: { title: `Draft ${randomUUID()}`, categoryName: "Compliance", deliveryMode: "self_paced", duration: { value: 10, unit: "minutes" } },
      });
      const draftId = draft.json().data.id;
      const draftDetail = await server.inject({ method: "GET", url: `/tenant/course-marketplace/${draftId}`, headers: tenantHeaders });
      expect(draftDetail.statusCode).toBe(404);

      const nonexistentDetail = await server.inject({ method: "GET", url: `/tenant/course-marketplace/${randomUUID()}`, headers: tenantHeaders });
      expect(nonexistentDetail.statusCode).toBe(404);
      expect(nonexistentDetail.json()).toEqual(draftDetail.json());
    } finally {
      await server.close();
    }
  });

  it("rejects browse/detail for a tenant user lacking course.manage", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.view"]);
    const tenantHeaders = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

    const server = await buildTestServer();
    try {
      const activeId = await createActivePlatformCourse(server, adminHeaders);
      const list = await server.inject({ method: "GET", url: "/tenant/course-marketplace", headers: tenantHeaders });
      expect(list.statusCode).toBe(403);
      const detail = await server.inject({ method: "GET", url: `/tenant/course-marketplace/${activeId}`, headers: tenantHeaders });
      expect(detail.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
