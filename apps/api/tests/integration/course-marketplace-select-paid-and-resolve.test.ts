import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole, seedSuperAdminSession } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

type Server = Awaited<ReturnType<typeof buildTestServer>>;
type Headers = Record<string, string>;

async function createActivePaidPlatformCourse(server: Server, adminHeaders: Headers) {
  const created = await server.inject({
    method: "POST",
    url: "/admin/platform-courses",
    headers: adminHeaders,
    payload: {
      title: `Paid Course ${randomUUID()}`,
      categoryName: "Leadership",
      deliveryMode: "self_paced",
      duration: { value: 60, unit: "minutes" },
      cost: 49.99,
    },
  });
  const courseId = created.json().data.id;
  await server.inject({ method: "POST", url: `/admin/platform-courses/${courseId}/modules`, headers: adminHeaders, payload: { title: "Module 1" } });
  await server.inject({ method: "PATCH", url: `/admin/platform-courses/${courseId}`, headers: adminHeaders, payload: { status: "active" } });
  return courseId as string;
}

describe("course marketplace select — paid course (spec 029 US5, FR-008/FR-009/FR-011/FR-012)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("creates a pending selection without cloning, then the Super Admin queue lists it, and marking it paid clones the course", async () => {
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
      const courseId = await createActivePaidPlatformCourse(server, adminHeaders);

      const select = await server.inject({ method: "POST", url: `/tenant/course-marketplace/${courseId}/select`, headers: tenantHeaders });
      expect(select.statusCode).toBe(201);
      expect(select.json().data.outcome).toBe("requested");
      const selectionId = select.json().data.selectionId as string;

      // Regression: alreadySelected/selectionStatus must reflect the pending request (read via
      // request.tenantDb — marketplace_selections has FORCE ROW LEVEL SECURITY).
      const detailWhileRequested = await server.inject({
        method: "GET",
        url: `/tenant/course-marketplace/${courseId}`,
        headers: tenantHeaders,
      });
      expect(detailWhileRequested.json().data.alreadySelected).toBe(true);
      expect(detailWhileRequested.json().data.selectionStatus).toBe("requested");

      const tenantCourses = await server.inject({ method: "GET", url: "/tenant/courses", headers: tenantHeaders });
      expect(tenantCourses.json().data).toHaveLength(0);

      const queue = await server.inject({ method: "GET", url: "/admin/marketplace-selections", headers: adminHeaders });
      expect(queue.statusCode).toBe(200);
      const queueIds = queue.json().data.map((s: { id: string }) => s.id);
      expect(queueIds).toContain(selectionId);

      const resolved = await server.inject({
        method: "POST",
        url: `/admin/marketplace-selections/${selectionId}/resolve`,
        headers: adminHeaders,
        payload: { decision: "paid" },
      });
      expect(resolved.statusCode).toBe(200);
      expect(resolved.json().data.status).toBe("fulfilled");
      expect(resolved.json().data.clonedCourseId).toBeTruthy();

      const afterResolve = await server.inject({ method: "GET", url: "/tenant/courses", headers: tenantHeaders });
      expect(afterResolve.json().data).toHaveLength(1);
      expect(afterResolve.json().data[0].id).toBe(resolved.json().data.clonedCourseId);

      const detailAfterResolve = await server.inject({
        method: "GET",
        url: `/tenant/course-marketplace/${courseId}`,
        headers: tenantHeaders,
      });
      expect(detailAfterResolve.json().data.selectionStatus).toBe("fulfilled");
    } finally {
      await server.close();
    }
  });

  it("rejects a duplicate selection while a prior one is still requested", async () => {
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
      const courseId = await createActivePaidPlatformCourse(server, adminHeaders);
      const first = await server.inject({ method: "POST", url: `/tenant/course-marketplace/${courseId}/select`, headers: tenantHeaders });
      expect(first.statusCode).toBe(201);
      const second = await server.inject({ method: "POST", url: `/tenant/course-marketplace/${courseId}/select`, headers: tenantHeaders });
      expect(second.statusCode).toBe(409);
    } finally {
      await server.close();
    }
  });

  it("a rejected resolution creates no clone and permits a later re-selection", async () => {
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
      const courseId = await createActivePaidPlatformCourse(server, adminHeaders);
      const select = await server.inject({ method: "POST", url: `/tenant/course-marketplace/${courseId}/select`, headers: tenantHeaders });
      const selectionId = select.json().data.selectionId as string;

      const rejected = await server.inject({
        method: "POST",
        url: `/admin/marketplace-selections/${selectionId}/resolve`,
        headers: adminHeaders,
        payload: { decision: "rejected" },
      });
      expect(rejected.statusCode).toBe(200);
      expect(rejected.json().data.status).toBe("rejected");

      const tenantCourses = await server.inject({ method: "GET", url: "/tenant/courses", headers: tenantHeaders });
      expect(tenantCourses.json().data).toHaveLength(0);

      const reselect = await server.inject({ method: "POST", url: `/tenant/course-marketplace/${courseId}/select`, headers: tenantHeaders });
      expect(reselect.statusCode).toBe(201);
    } finally {
      await server.close();
    }
  });

  it("rejects resolve actions for non-Super-Admin callers, including the requesting tenant's own user", async () => {
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
      const courseId = await createActivePaidPlatformCourse(server, adminHeaders);
      const select = await server.inject({ method: "POST", url: `/tenant/course-marketplace/${courseId}/select`, headers: tenantHeaders });
      const selectionId = select.json().data.selectionId as string;

      const tenantAttempt = await server.inject({
        method: "POST",
        url: `/admin/marketplace-selections/${selectionId}/resolve`,
        headers: tenantHeaders,
        payload: { decision: "paid" },
      });
      expect(tenantAttempt.statusCode).toBe(401);

      const noAuth = await server.inject({
        method: "POST",
        url: `/admin/marketplace-selections/${selectionId}/resolve`,
        payload: { decision: "paid" },
      });
      expect(noAuth.statusCode).toBe(401);
    } finally {
      await server.close();
    }
  });
});
