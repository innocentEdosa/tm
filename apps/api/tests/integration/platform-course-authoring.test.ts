import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole, seedSuperAdminSession } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

describe("platform course authoring (spec 029 US1, FR-001/FR-002/FR-005)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("creates a platform course with all required fields, defaulting to draft with audit fields set", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/admin/platform-courses",
        headers: { cookie: cookieHeader },
        payload: {
          title: "Workplace Safety Basics",
          categoryName: "Compliance",
          deliveryMode: "self_paced",
          duration: { value: 30, unit: "minutes" },
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data.status).toBe("draft");
      expect(body.data.categoryName).toBe("Compliance");
      expect(body.data.createdBySuperAdminId).toBeTruthy();
    } finally {
      await server.close();
    }
  });

  it("rejects a create request missing a required field", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/admin/platform-courses",
        headers: { cookie: cookieHeader },
        payload: { categoryName: "Compliance", deliveryMode: "self_paced", duration: { value: 30, unit: "minutes" } },
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("rejects an invalid deliveryMode and a negative cost", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const invalidMode = await server.inject({
        method: "POST",
        url: "/admin/platform-courses",
        headers: { cookie: cookieHeader },
        payload: {
          title: "Bad Mode",
          categoryName: "Compliance",
          deliveryMode: "not_a_mode",
          duration: { value: 30, unit: "minutes" },
        },
      });
      expect(invalidMode.statusCode).toBe(422);

      const negativeCost = await server.inject({
        method: "POST",
        url: "/admin/platform-courses",
        headers: { cookie: cookieHeader },
        payload: {
          title: "Bad Cost",
          categoryName: "Compliance",
          deliveryMode: "self_paced",
          duration: { value: 30, unit: "minutes" },
          cost: -5,
        },
      });
      expect(negativeCost.statusCode).toBe(422);
    } finally {
      await server.close();
    }
  });

  it("allows Super Admin to update status directly, list, and get by id", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const created = await server.inject({
        method: "POST",
        url: "/admin/platform-courses",
        headers: { cookie: cookieHeader },
        payload: {
          title: "Onboarding Essentials",
          categoryName: "Onboarding",
          deliveryMode: "self_paced",
          duration: { value: 45, unit: "minutes" },
        },
      });
      const id = created.json().data.id;

      const patched = await server.inject({
        method: "PATCH",
        url: `/admin/platform-courses/${id}`,
        headers: { cookie: cookieHeader },
        payload: { status: "active" },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json().data.status).toBe("active");

      const list = await server.inject({
        method: "GET",
        url: "/admin/platform-courses?status=active",
        headers: { cookie: cookieHeader },
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().data.map((c: { id: string }) => c.id)).toContain(id);

      const detail = await server.inject({
        method: "GET",
        url: `/admin/platform-courses/${id}`,
        headers: { cookie: cookieHeader },
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().data.title).toBe("Onboarding Essentials");
    } finally {
      await server.close();
    }
  });

  it("returns 404 for an unknown platform course id", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: `/admin/platform-courses/${randomUUID()}`,
        headers: { cookie: cookieHeader },
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("rejects every platform-course authoring action without a valid Super Admin session, including a tenant course.manage holder", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const noAuth = await server.inject({ method: "GET", url: "/admin/platform-courses" });
      expect(noAuth.statusCode).toBe(401);

      const tenantHeaders = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const tenantAttempt = await server.inject({
        method: "POST",
        url: "/admin/platform-courses",
        headers: tenantHeaders,
        payload: {
          title: "Should Not Work",
          categoryName: "Compliance",
          deliveryMode: "self_paced",
          duration: { value: 30, unit: "minutes" },
        },
      });
      expect(tenantAttempt.statusCode).toBe(401);
    } finally {
      await server.close();
    }
  });
});
