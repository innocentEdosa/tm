import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { users } from "../../src/db/schema/users";
import { userRoles } from "../../src/db/schema/roles";

describe("GET /tenants/:id/roles (spec FR-005)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns permissionKeys/isSystem/memberCount correctly", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, `Custom Role ${randomUUID()}`, ["manage_roles"]);

    await withTenantDb(tenantId, async (db) => {
      const [member] = await db
        .insert(users)
        .values({ tenantId, fullName: "Member One", email: `member-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId, userId: member.id, roleId });
    });

    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: `/tenants/${tenantId}/roles`,
        headers: { cookie: cookieHeader },
      });
      expect(response.statusCode).toBe(200);
      const data = response.json().data as Array<Record<string, unknown>>;
      const role = data.find((r) => r.id === roleId);
      expect(role).toMatchObject({
        isSystem: false,
        memberCount: 1,
        permissionKeys: ["manage_roles"],
      });
    } finally {
      await server.close();
    }
  });

  it("intersects the reused getRoleMemberCounts helper correctly across two tenants (research.md §2)", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    await seedTenant(tenantA);
    await seedTenant(tenantB);
    const { roleId: roleAId } = await seedRole(tenantA, `Role A ${randomUUID()}`);
    const { roleId: roleBId } = await seedRole(tenantB, `Role B ${randomUUID()}`);

    // Tenant B's role has members; tenant A's does not — proves tenant A's response reports 0,
    // never tenant B's non-zero count for an unrelated role id.
    await withTenantDb(tenantB, async (db) => {
      const [member] = await db
        .insert(users)
        .values({ tenantId: tenantB, fullName: "B Member", email: `bmember-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId: tenantB, userId: member.id, roleId: roleBId });
    });

    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: `/tenants/${tenantA}/roles`,
        headers: { cookie: cookieHeader },
      });
      expect(response.statusCode).toBe(200);
      const data = response.json().data as Array<Record<string, unknown>>;
      const roleA = data.find((r) => r.id === roleAId);
      expect(roleA?.memberCount).toBe(0);
      expect(data.find((r) => r.id === roleBId)).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("returns an empty array (not an error) for a tenant with zero custom roles", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { cookieHeader } = await seedSuperAdminSession();

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: `/tenants/${tenantId}/roles`,
        headers: { cookie: cookieHeader },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual([]);
    } finally {
      await server.close();
    }
  });
});
