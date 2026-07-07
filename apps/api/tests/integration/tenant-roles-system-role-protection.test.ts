import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { buildTestServer } from "../helpers/test-server";
import { seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedDefaultRolesForTenant } from "../../src/permissions/seed-default-roles";
import { roles } from "../../src/db/schema/roles";

describe("system roles are provably unmodifiable via direct API calls (spec FR-005/SC-002)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("rejects PATCH against a system role with 403, even for a manage_roles-holding user", async () => {
    const tenantId = randomUUID();
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["manage_roles"]);
    await withTenantDb(tenantId, (db) => seedDefaultRolesForTenant(db, tenantId));
    const hrAdminRoleId = await withTenantDb(tenantId, async (db) => {
      const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, "HR/L&D Admin"));
      return role.id;
    });

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenant/roles/${hrAdminRoleId}`,
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
        payload: { name: "Hijacked" },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().message).toBe("System roles cannot be modified.");
    } finally {
      await server.close();
    }

    const stillNamed = await withTenantDb(tenantId, async (db) => {
      const [role] = await db.select({ name: roles.name }).from(roles).where(eq(roles.id, hrAdminRoleId));
      return role.name;
    });
    expect(stillNamed).toBe("HR/L&D Admin");
  });

  it("rejects DELETE against a system role with 403, even with zero members assigned", async () => {
    const tenantId = randomUUID();
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["manage_roles"]);
    await withTenantDb(tenantId, (db) => seedDefaultRolesForTenant(db, tenantId));
    const employeeRoleId = await withTenantDb(tenantId, async (db) => {
      const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, "Employee/Learner"));
      return role.id;
    });

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "DELETE",
        url: `/tenant/roles/${employeeRoleId}`,
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().message).toBe("System roles cannot be modified.");
    } finally {
      await server.close();
    }

    const stillExists = await withTenantDb(tenantId, async (db) => {
      const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, employeeRoleId));
      return role;
    });
    expect(stillExists).toBeDefined();
  });
});
