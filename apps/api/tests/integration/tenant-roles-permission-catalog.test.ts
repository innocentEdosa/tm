import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

describe("GET /tenant/permission-catalog (spec FR-007/FR-008)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns every permission with its category, flat (no server-side grouping)", async () => {
    const tenantId = randomUUID();
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["manage_roles"]);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: "/tenant/permission-catalog",
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      const manageRoles = body.data.find((p: { key: string }) => p.key === "manage_roles");
      expect(manageRoles).toMatchObject({ category: "roles", displayName: expect.any(String), description: expect.any(String) });

      const departmentPerm = body.data.find((p: { key: string }) => p.key === "department.manage");
      expect(departmentPerm.category).toBe("department");

      const categories = new Set(body.data.map((p: { category: string }) => p.category));
      expect(categories.size).toBeGreaterThan(1);

      // platform-only keys are never checked by any tenant-scoped route (only by
      // requireSuperAdminSession), so granting them to a custom tenant role would be a no-op —
      // excluded from this tenant-facing catalog entirely.
      expect(categories.has("platform")).toBe(false);
      expect(body.data.find((p: { key: string }) => p.key === "provision_tenant")).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("is rejected for a user without manage_roles", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedUserWithRole(tenantId, userId, []);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: "/tenant/permission-catalog",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
