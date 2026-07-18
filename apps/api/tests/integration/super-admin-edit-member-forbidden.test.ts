import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { users } from "../../src/db/schema/users";
import { userRoles } from "../../src/db/schema/roles";

describe("PATCH /tenants/:id/members/:memberId — not-found and forbidden (spec FR-003, FR-011)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("404s for a nonexistent memberId", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenants/${tenantId}/members/${randomUUID()}`,
        headers: { cookie: cookieHeader },
        payload: { fullName: "Nobody" },
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("404s for a memberId belonging to a different tenant", async () => {
    const tenantId = randomUUID();
    const otherTenantId = randomUUID();
    await seedTenant(tenantId);
    await seedTenant(otherTenantId);
    const { roleId } = await seedRole(otherTenantId, `Role ${randomUUID()}`);
    const otherMemberId = await withTenantDb(otherTenantId, async (db) => {
      const [member] = await db
        .insert(users)
        .values({ tenantId: otherTenantId, fullName: "Other Tenant Person", email: `other-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId: otherTenantId, userId: member.id, roleId });
      return member.id;
    });

    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenants/${tenantId}/members/${otherMemberId}`,
        headers: { cookie: cookieHeader },
        payload: { fullName: "Hijacked" },
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("401s without a Super Admin session", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenants/${tenantId}/members/${randomUUID()}`,
        payload: { fullName: "Nobody" },
      });
      expect(response.statusCode).toBe(401);
    } finally {
      await server.close();
    }
  });
});
