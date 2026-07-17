import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { users } from "../../src/db/schema/users";

describe("Two concurrent add-member requests with the same email leave exactly one member (spec Edge Cases)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("one request succeeds with 201, the other is rejected with 409, never two rows", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    const { cookieHeader } = await seedSuperAdminSession();
    const email = `concurrent-${randomUUID()}@example.com`;

    const server = await buildTestServer();
    try {
      const [responseA, responseB] = await Promise.all([
        server.inject({
          method: "POST",
          url: `/tenants/${tenantId}/members`,
          headers: { cookie: cookieHeader },
          payload: { fullName: "A", email, roleId },
        }),
        server.inject({
          method: "POST",
          url: `/tenants/${tenantId}/members`,
          headers: { cookie: cookieHeader },
          payload: { fullName: "B", email, roleId },
        }),
      ]);

      const statusCodes = [responseA.statusCode, responseB.statusCode].sort();
      expect(statusCodes).toEqual([201, 409]);

      const rows = await withTenantDb(tenantId, async (db) =>
        db.select({ id: users.id }).from(users).where(eq(users.email, email)),
      );
      expect(rows).toHaveLength(1);
    } finally {
      await server.close();
    }
  });
});
