import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { users } from "../../src/db/schema/users";

describe("POST /tenants/:id/members — duplicate email (spec FR-004)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("rejects a second member with the same email at the same tenant, creating no second row", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    const { cookieHeader } = await seedSuperAdminSession();
    const email = `dup-${randomUUID()}@example.com`;

    const server = await buildTestServer();
    try {
      const first = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/members`,
        headers: { cookie: cookieHeader },
        payload: { fullName: "First", email, roleId },
      });
      expect(first.statusCode).toBe(201);

      const second = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/members`,
        headers: { cookie: cookieHeader },
        payload: { fullName: "Second", email, roleId },
      });
      expect(second.statusCode).toBe(409);

      const rows = await withTenantDb(tenantId, async (db) =>
        db.select({ id: users.id }).from(users).where(eq(users.email, email)),
      );
      expect(rows).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("allows the same email at a different tenant", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    await seedTenant(tenantA);
    await seedTenant(tenantB);
    const { roleId: roleAId } = await seedRole(tenantA, `Role A ${randomUUID()}`);
    const { roleId: roleBId } = await seedRole(tenantB, `Role B ${randomUUID()}`);
    const { cookieHeader } = await seedSuperAdminSession();
    const email = `shared-${randomUUID()}@example.com`;

    const server = await buildTestServer();
    try {
      const first = await server.inject({
        method: "POST",
        url: `/tenants/${tenantA}/members`,
        headers: { cookie: cookieHeader },
        payload: { fullName: "Tenant A Member", email, roleId: roleAId },
      });
      expect(first.statusCode).toBe(201);

      const second = await server.inject({
        method: "POST",
        url: `/tenants/${tenantB}/members`,
        headers: { cookie: cookieHeader },
        payload: { fullName: "Tenant B Member", email, roleId: roleBId },
      });
      expect(second.statusCode).toBe(201);
    } finally {
      await server.close();
    }
  });
});
