import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { users } from "../../src/db/schema/users";
import { userRoles } from "../../src/db/schema/roles";

describe("POST /tenants/:id/members/:memberId/reset-password — wrong tenant / nonexistent member (spec FR-008 Edge Cases)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns 404 for a memberId that belongs to a different tenant", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    await seedTenant(tenantA);
    await seedTenant(tenantB);
    const { roleId } = await seedRole(tenantB, `Role ${randomUUID()}`);
    const memberOfB = await withTenantDb(tenantB, async (db) => {
      const [member] = await db
        .insert(users)
        .values({ tenantId: tenantB, fullName: "Tenant B Member", email: `b-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId: tenantB, userId: member.id, roleId });
      return member.id;
    });

    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/tenants/${tenantA}/members/${memberOfB}/reset-password`,
        headers: { cookie: cookieHeader },
      });
      expect(response.statusCode).toBe(404);

      // The member's password must remain untouched.
      const [row] = await withTenantDb(tenantB, async (db) =>
        db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, memberOfB)),
      );
      expect(row.passwordHash).toBeNull();
    } finally {
      await server.close();
    }
  });

  it("returns 404 for a memberId that does not exist at all", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { cookieHeader } = await seedSuperAdminSession();

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/members/${randomUUID()}/reset-password`,
        headers: { cookie: cookieHeader },
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });
});
