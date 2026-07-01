import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedUserWithRole, seedRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { roles, rolePermissions } from "../../src/db/schema/roles";
import { permissions } from "../../src/db/schema/permissions";
import { eq } from "drizzle-orm";

describe("tenant role customization (PATCH /tenant/roles/:roleId)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("renames a role and removes a permission, scoped to the caller's own tenant", async () => {
    const tenantId = randomUUID();
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["manage_roles"]);
    const { roleId } = await seedRole(tenantId, "Manager", [
      "approve_enrollment",
      "view_department_analytics",
    ]);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenant/roles/${roleId}`,
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
        payload: { name: "Team Lead", permissionKeys: ["approve_enrollment"] },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.name).toBe("Team Lead");
      expect(body.data.permissionKeys).toEqual(["approve_enrollment"]);
    } finally {
      await server.close();
    }

    const persisted = await withTenantDb(tenantId, async (db) => {
      const [role] = await db.select({ name: roles.name }).from(roles).where(eq(roles.id, roleId));
      const perms = await db
        .select({ key: permissions.key })
        .from(rolePermissions)
        .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .where(eq(rolePermissions.roleId, roleId));
      return { name: role.name, keys: perms.map((p) => p.key) };
    });
    expect(persisted.name).toBe("Team Lead");
    expect(persisted.keys).toEqual(["approve_enrollment"]);
  });
});
