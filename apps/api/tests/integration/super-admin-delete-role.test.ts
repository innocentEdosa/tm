import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb, withSuperAdminTransaction } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole, seedUserWithRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { roles } from "../../src/db/schema/roles";
import { tenantConfigActionLog } from "../../src/db/schema/tenant-config-action-log";

describe("DELETE /tenants/:id/roles/:roleId (spec FR-004/FR-005)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("rejects deleting a role with members assigned, with 409", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    const { roleId } = await seedUserWithRole(tenantId, userId, []);
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "DELETE",
        url: `/tenants/${tenantId}/roles/${roleId}`,
        headers: { cookie: cookieHeader },
      });
      expect(response.statusCode).toBe(409);

      const [row] = await withTenantDb(tenantId, async (db) =>
        db.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId)),
      );
      expect(row).toBeTruthy();
    } finally {
      await server.close();
    }
  });

  it("deletes a role with zero members and logs the action", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, `Deletable ${randomUUID()}`);
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "DELETE",
        url: `/tenants/${tenantId}/roles/${roleId}`,
        headers: { cookie: cookieHeader },
      });
      expect(response.statusCode).toBe(204);

      const rows = await withTenantDb(tenantId, async (db) =>
        db.select().from(roles).where(eq(roles.id, roleId)),
      );
      expect(rows).toHaveLength(0);

      const logRows = await withSuperAdminTransaction(async (client) => {
        const db = drizzle(client);
        return db
          .select()
          .from(tenantConfigActionLog)
          .where(eq(tenantConfigActionLog.entityId, roleId));
      });
      expect(logRows).toHaveLength(1);
      expect(logRows[0]).toMatchObject({ tenantId, entityType: "role", action: "role_deleted" });
    } finally {
      await server.close();
    }
  });
});
