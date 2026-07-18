import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { roles } from "../../src/db/schema/roles";

describe("PATCH /tenants/:id/roles/:roleId (spec FR-004)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("edits name, description, and permission set of a custom role", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, `Original ${randomUUID()}`, ["manage_roles"]);
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenants/${tenantId}/roles/${roleId}`,
        headers: { cookie: cookieHeader },
        payload: { name: "Renamed Role", description: "New desc", permissionKeys: ["approve_enrollment"] },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.name).toBe("Renamed Role");
      expect(body.data.permissionKeys).toEqual(["approve_enrollment"]);

      const [row] = await withTenantDb(tenantId, async (db) =>
        db.select().from(roles).where(eq(roles.id, roleId)),
      );
      expect(row.name).toBe("Renamed Role");
      expect(row.description).toBe("New desc");
    } finally {
      await server.close();
    }
  });
});
