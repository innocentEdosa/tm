import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { roles, rolePermissions } from "../../src/db/schema/roles";
import { permissions } from "../../src/db/schema/permissions";

describe("POST /tenants/:id/roles (spec FR-004)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("creates a role scoped to the tenant with its permissions", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/roles`,
        headers: { cookie: cookieHeader },
        payload: { name: `Console Role ${randomUUID()}`, permissionKeys: ["manage_roles"] },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data.permissionKeys).toContain("manage_roles");

      const [row] = await withTenantDb(tenantId, async (db) =>
        db.select().from(roles).where(eq(roles.id, body.data.id)),
      );
      expect(row.tenantId).toBe(tenantId);
    } finally {
      await server.close();
    }
  });

  it("silently drops a platform-category permission key from the submitted set", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/roles`,
        headers: { cookie: cookieHeader },
        payload: {
          name: `No Platform Perms ${randomUUID()}`,
          permissionKeys: ["manage_roles", "view_permission_catalog"],
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data.permissionKeys).toContain("manage_roles");
      expect(body.data.permissionKeys).not.toContain("view_permission_catalog");

      const rows = await withTenantDb(tenantId, async (db) =>
        db
          .select({ key: permissions.key })
          .from(rolePermissions)
          .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
          .where(eq(rolePermissions.roleId, body.data.id)),
      );
      expect(rows.map((r) => r.key)).not.toContain("view_permission_catalog");
    } finally {
      await server.close();
    }
  });

  it("400s when name is missing", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/roles`,
        headers: { cookie: cookieHeader },
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await server.close();
    }
  });
});
