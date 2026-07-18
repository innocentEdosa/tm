import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { users } from "../../src/db/schema/users";
import { userRoles } from "../../src/db/schema/roles";

describe("PATCH /tenants/:id/members/:memberId — cross-tenant validation (spec FR-003, research.md §1)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  async function seedMember(tenantId: string, roleId: string) {
    return withTenantDb(tenantId, async (db) => {
      const [member] = await db
        .insert(users)
        .values({ tenantId, fullName: "Member", email: `member-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId, userId: member.id, roleId });
      return member.id;
    });
  }

  it("rejects a roleId belonging to a different tenant with 422", async () => {
    const tenantId = randomUUID();
    const otherTenantId = randomUUID();
    await seedTenant(tenantId);
    await seedTenant(otherTenantId);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    const { roleId: otherTenantRoleId } = await seedRole(otherTenantId, `Other Role ${randomUUID()}`);
    const memberId = await seedMember(tenantId, roleId);

    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenants/${tenantId}/members/${memberId}`,
        headers: { cookie: cookieHeader },
        payload: { roleId: otherTenantRoleId },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().message).toMatch(/role/i);
    } finally {
      await server.close();
    }
  });

  it("rejects a departmentId belonging to a different tenant with 422", async () => {
    const tenantId = randomUUID();
    const otherTenantId = randomUUID();
    await seedTenant(tenantId);
    await seedTenant(otherTenantId);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    const memberId = await seedMember(tenantId, roleId);

    const { departments } = await import("../../src/db/schema/departments");
    const otherDeptId = await withTenantDb(otherTenantId, async (db) => {
      const [dept] = await db
        .insert(departments)
        .values({ tenantId: otherTenantId, name: `Other Dept ${randomUUID()}`, status: "active" })
        .returning({ id: departments.id });
      return dept.id;
    });

    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenants/${tenantId}/members/${memberId}`,
        headers: { cookie: cookieHeader },
        payload: { departmentId: otherDeptId },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().message).toMatch(/department/i);
    } finally {
      await server.close();
    }
  });
});
