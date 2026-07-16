import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { users } from "../../src/db/schema/users";
import { userRoles } from "../../src/db/schema/roles";

describe("Password reset succeeds identically for an archived tenant's member (spec FR-013)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("resets a member's password after the tenant has been archived", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId, `Archived Reset Test ${tenantId}`);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    const memberId = await withTenantDb(tenantId, async (db) => {
      const [member] = await db
        .insert(users)
        .values({ tenantId, fullName: "Archived Tenant Member", email: `archived-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId, userId: member.id, roleId });
      return member.id;
    });

    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const archiveResponse = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/archive`,
        headers: { cookie: cookieHeader },
      });
      expect(archiveResponse.statusCode).toBe(200);

      const resetResponse = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/members/${memberId}/reset-password`,
        headers: { cookie: cookieHeader },
      });
      expect(resetResponse.statusCode).toBe(200);
      expect(resetResponse.json().data.generatedPassword).toBeTruthy();
    } finally {
      await server.close();
    }
  });
});
