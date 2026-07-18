import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { roles } from "../../src/db/schema/roles";
import { roleTemplates } from "../../src/db/schema/role-templates";

describe("System role protection on PATCH/DELETE /tenants/:id/roles/:roleId (spec FR-005)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  async function seedSystemRole(tenantId: string): Promise<string> {
    return withTenantDb(tenantId, async (db) => {
      const [template] = await db
        .select({ id: roleTemplates.id })
        .from(roleTemplates)
        .where(eq(roleTemplates.key, "employee"));
      const [role] = await db
        .insert(roles)
        .values({ tenantId, name: `Employee ${randomUUID()}`, sourceTemplateId: template.id })
        .returning({ id: roles.id });
      return role.id;
    });
  }

  it("rejects editing a system role with 403", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const systemRoleId = await seedSystemRole(tenantId);
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenants/${tenantId}/roles/${systemRoleId}`,
        headers: { cookie: cookieHeader },
        payload: { name: "Attempted Rename" },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().message).toMatch(/system roles cannot be modified/i);

      const [row] = await withTenantDb(tenantId, async (db) =>
        db.select({ name: roles.name }).from(roles).where(eq(roles.id, systemRoleId)),
      );
      expect(row.name).not.toBe("Attempted Rename");
    } finally {
      await server.close();
    }
  });

  it("rejects deleting a system role with 403", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const systemRoleId = await seedSystemRole(tenantId);
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "DELETE",
        url: `/tenants/${tenantId}/roles/${systemRoleId}`,
        headers: { cookie: cookieHeader },
      });
      expect(response.statusCode).toBe(403);

      const [row] = await withTenantDb(tenantId, async (db) =>
        db.select({ id: roles.id }).from(roles).where(eq(roles.id, systemRoleId)),
      );
      expect(row).toBeTruthy();
    } finally {
      await server.close();
    }
  });
});
