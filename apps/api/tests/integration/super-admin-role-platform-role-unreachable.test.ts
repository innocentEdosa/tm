import { randomUUID } from "node:crypto";
import { eq, isNull } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withSuperAdminTransaction } from "../helpers/pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { roles } from "../../src/db/schema/roles";

describe("Platform-wide Super Admin role is unreachable through /tenants/:id/roles (spec FR-006)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("PATCH/DELETE on the platform role id, scoped to any tenant, resolve as not-found", async () => {
    const platformRoleId = await withSuperAdminTransaction(async (client) => {
      const db = drizzle(client);
      const [row] = await db.select({ id: roles.id }).from(roles).where(isNull(roles.tenantId));
      return row.id;
    });
    expect(platformRoleId).toBeTruthy();

    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const patchResponse = await server.inject({
        method: "PATCH",
        url: `/tenants/${tenantId}/roles/${platformRoleId}`,
        headers: { cookie: cookieHeader },
        payload: { name: "Hijack Attempt" },
      });
      expect(patchResponse.statusCode).toBe(404);

      const deleteResponse = await server.inject({
        method: "DELETE",
        url: `/tenants/${tenantId}/roles/${platformRoleId}`,
        headers: { cookie: cookieHeader },
      });
      expect(deleteResponse.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });
});
