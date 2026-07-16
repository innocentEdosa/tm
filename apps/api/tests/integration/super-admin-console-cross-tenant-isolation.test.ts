import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";
import { userRoles } from "../../src/db/schema/roles";

/**
 * Regression guard for the exact bug class research.md §1/§3 flags: `request.superAdminDb`'s
 * `app.tenant_id` is pinned to the nil UUID, so any handler that forgot an explicit `tenant_id`
 * filter would silently merge every tenant's rows together instead of scoping to the route's `:id`.
 */
describe("Super Admin Tenant Console — cross-tenant isolation (research.md §1, §3)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("never returns tenant B's departments/roles/members from tenant A's console routes", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    await seedTenant(tenantA, `Console Isolation A ${tenantA}`);
    await seedTenant(tenantB, `Console Isolation B ${tenantB}`);

    const { deptA, memberA } = await withTenantDb(tenantA, async (db) => {
      const [deptA] = await db
        .insert(departments)
        .values({ tenantId: tenantA, name: `Dept A ${randomUUID()}` })
        .returning({ id: departments.id });
      const [memberA] = await db
        .insert(users)
        .values({ tenantId: tenantA, fullName: "Alice A", email: `alice-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      return { deptA, memberA };
    });
    const { roleId: roleAId } = await seedRole(tenantA, `Role A ${randomUUID()}`);
    await withTenantDb(tenantA, async (db) => {
      await db.insert(userRoles).values({ tenantId: tenantA, userId: memberA.id, roleId: roleAId });
    });

    const { deptB, memberB } = await withTenantDb(tenantB, async (db) => {
      const [deptB] = await db
        .insert(departments)
        .values({ tenantId: tenantB, name: `Dept B ${randomUUID()}` })
        .returning({ id: departments.id });
      const [memberB] = await db
        .insert(users)
        .values({ tenantId: tenantB, fullName: "Bob B", email: `bob-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      return { deptB, memberB };
    });
    const { roleId: roleBId } = await seedRole(tenantB, `Role B ${randomUUID()}`);
    await withTenantDb(tenantB, async (db) => {
      await db.insert(userRoles).values({ tenantId: tenantB, userId: memberB.id, roleId: roleBId });
    });

    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const deptResponse = await server.inject({
        method: "GET",
        url: `/tenants/${tenantA}/departments`,
        headers: { cookie: cookieHeader },
      });
      expect(deptResponse.statusCode).toBe(200);
      const deptIds = deptResponse.json().data.map((d: { id: string }) => d.id);
      expect(deptIds).toContain(deptA.id);
      expect(deptIds).not.toContain(deptB.id);

      const rolesResponse = await server.inject({
        method: "GET",
        url: `/tenants/${tenantA}/roles`,
        headers: { cookie: cookieHeader },
      });
      expect(rolesResponse.statusCode).toBe(200);
      const roleIds = rolesResponse.json().data.map((r: { id: string }) => r.id);
      expect(roleIds).toContain(roleAId);
      expect(roleIds).not.toContain(roleBId);

      const membersResponse = await server.inject({
        method: "GET",
        url: `/tenants/${tenantA}/members?pageSize=1000`,
        headers: { cookie: cookieHeader },
      });
      expect(membersResponse.statusCode).toBe(200);
      const memberIds = membersResponse.json().data.map((m: { id: string }) => m.id);
      expect(memberIds).toContain(memberA.id);
      expect(memberIds).not.toContain(memberB.id);

      // Reverse direction — tenant B's routes must equally never surface tenant A's rows.
      const deptResponseB = await server.inject({
        method: "GET",
        url: `/tenants/${tenantB}/departments`,
        headers: { cookie: cookieHeader },
      });
      const deptIdsB = deptResponseB.json().data.map((d: { id: string }) => d.id);
      expect(deptIdsB).toContain(deptB.id);
      expect(deptIdsB).not.toContain(deptA.id);
    } finally {
      await server.close();
    }
  });
});
