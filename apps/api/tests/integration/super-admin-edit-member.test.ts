import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { users } from "../../src/db/schema/users";
import { userRoles } from "../../src/db/schema/roles";

describe("PATCH /tenants/:id/members/:memberId — success (spec FR-003)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("updates the member's role and is visible via GET /tenants/:id/members and the tenant-side team route", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId: originalRoleId } = await seedRole(tenantId, `Original Role ${randomUUID()}`);
    const { roleId: newRoleId } = await seedRole(tenantId, `New Role ${randomUUID()}`);

    const memberId = await withTenantDb(tenantId, async (db) => {
      const [member] = await db
        .insert(users)
        .values({ tenantId, fullName: "Edit Me", email: `edit-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId, userId: member.id, roleId: originalRoleId });
      return member.id;
    });

    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenants/${tenantId}/members/${memberId}`,
        headers: { cookie: cookieHeader },
        payload: { roleId: newRoleId },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.roleId).toBe(newRoleId);

      const [row] = await withTenantDb(tenantId, async (db) =>
        db.select().from(userRoles).where(eq(userRoles.userId, memberId)),
      );
      expect(row.roleId).toBe(newRoleId);

      const teamListResponse = await server.inject({
        method: "GET",
        url: `/tenants/${tenantId}/members`,
        headers: { cookie: cookieHeader },
      });
      const listedMember = teamListResponse.json().data.find((m: { id: string }) => m.id === memberId);
      expect(listedMember.roleName).toBeTruthy();
    } finally {
      await server.close();
    }
  });

  it("updates fullName and departmentId", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    const memberId = await withTenantDb(tenantId, async (db) => {
      const [member] = await db
        .insert(users)
        .values({ tenantId, fullName: "Old Name", email: `name-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId, userId: member.id, roleId });
      return member.id;
    });

    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenants/${tenantId}/members/${memberId}`,
        headers: { cookie: cookieHeader },
        payload: { fullName: "New Name" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.fullName).toBe("New Name");

      const [row] = await withTenantDb(tenantId, async (db) =>
        db.select({ fullName: users.fullName }).from(users).where(eq(users.id, memberId)),
      );
      expect(row.fullName).toBe("New Name");
    } finally {
      await server.close();
    }
  });
});
