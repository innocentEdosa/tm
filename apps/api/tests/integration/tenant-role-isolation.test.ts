import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { buildTestServer } from "../helpers/test-server";
import { seedUserWithRole, seedRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { roles, rolePermissions } from "../../src/db/schema/roles";
import { permissions } from "../../src/db/schema/permissions";

describe("tenant role isolation (spec Acceptance Scenario 3)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("renaming/reconfiguring a role in tenant A leaves tenant B's roles entirely unaffected", async () => {
    const tenantA = randomUUID();
    const adminA = randomUUID();
    await seedUserWithRole(tenantA, adminA, ["manage_roles"]);
    const { roleId: roleAId } = await seedRole(tenantA, "Manager", ["approve_enrollment"]);

    const tenantB = randomUUID();
    const { roleId: roleBId } = await seedRole(tenantB, "Manager", ["view_department_analytics"]);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenant/roles/${roleAId}`,
        headers: { "x-test-user-id": adminA, "x-test-tenant-id": tenantA },
        payload: { name: "Team Lead", permissionKeys: [] },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await server.close();
    }

    const tenantBRoleAfter = await withTenantDb(tenantB, async (db) => {
      const [role] = await db.select({ name: roles.name }).from(roles).where(eq(roles.id, roleBId));
      const perms = await db
        .select({ key: permissions.key })
        .from(rolePermissions)
        .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .where(eq(rolePermissions.roleId, roleBId));
      return { name: role.name, keys: perms.map((p) => p.key) };
    });

    expect(tenantBRoleAfter.name).toBe("Manager");
    expect(tenantBRoleAfter.keys).toEqual(["view_department_analytics"]);
  });
});
