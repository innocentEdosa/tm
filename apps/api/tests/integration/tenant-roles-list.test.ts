import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedUserWithRole, seedRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedDefaultRolesForTenant } from "../../src/permissions/seed-default-roles";

describe("GET /tenant/roles (spec FR-001/FR-002)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns every tenant role — system and custom — with isSystem, memberCount, and permissionKeys", async () => {
    const tenantId = randomUUID();
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["manage_roles"]);
    await withTenantDb(tenantId, (db) => seedDefaultRolesForTenant(db, tenantId));
    const { roleId: customRoleId } = await seedRole(tenantId, "Content Reviewer", ["edit_content_library"]);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: "/tenant/roles",
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      const roleNames = body.data.map((r: { name: string }) => r.name);
      expect(roleNames).toContain("HR/L&D Admin");
      expect(roleNames).toContain("Content Reviewer");

      const hrAdmin = body.data.find((r: { name: string }) => r.name === "HR/L&D Admin");
      expect(hrAdmin.isSystem).toBe(true);
      expect(hrAdmin.permissionKeys).toContain("manage_roles");

      const customRole = body.data.find((r: { id: string }) => r.id === customRoleId);
      expect(customRole.isSystem).toBe(false);
      expect(customRole.permissionKeys).toEqual(["edit_content_library"]);
      expect(customRole.memberCount).toBe(0);

      // The admin themselves holds a system role — reflected in that role's own memberCount.
      const adminRole = body.data.find((r: { id: string; memberCount: number }) => r.id !== customRoleId && r.memberCount >= 1);
      expect(adminRole).toBeDefined();
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
        url: "/tenant/roles",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
