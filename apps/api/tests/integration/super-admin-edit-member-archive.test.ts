import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { users } from "../../src/db/schema/users";
import { userRoles } from "../../src/db/schema/roles";
import { departments } from "../../src/db/schema/departments";

describe("PATCH /tenants/:id/members/:memberId — archive (spec FR-003, mirroring Spec 013's isDepartmentLeader block)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("rejects archiving a department Manager with 422 and the reassign-first message", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);

    const { memberId } = await withTenantDb(tenantId, async (db) => {
      const [member] = await db
        .insert(users)
        .values({ tenantId, fullName: "Manager Person", email: `mgr-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId, userId: member.id, roleId });
      await db.insert(departments).values({
        tenantId,
        name: `Dept ${randomUUID()}`,
        status: "active",
        managerId: member.id,
      });
      return { memberId: member.id };
    });

    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenants/${tenantId}/members/${memberId}`,
        headers: { cookie: cookieHeader },
        payload: { archived: true },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().message).toMatch(/manager|reassign/i);

      const [row] = await withTenantDb(tenantId, async (db) =>
        db.select({ archivedAt: users.archivedAt }).from(users).where(eq(users.id, memberId)),
      );
      expect(row.archivedAt).toBeNull();
    } finally {
      await server.close();
    }
  });

  it("archives an ordinary member successfully", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    const memberId = await withTenantDb(tenantId, async (db) => {
      const [member] = await db
        .insert(users)
        .values({ tenantId, fullName: "Ordinary Person", email: `ord-${randomUUID()}@example.com` })
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
        payload: { archived: true },
      });
      expect(response.statusCode).toBe(200);

      const [row] = await withTenantDb(tenantId, async (db) =>
        db.select({ archivedAt: users.archivedAt }).from(users).where(eq(users.id, memberId)),
      );
      expect(row.archivedAt).not.toBeNull();
    } finally {
      await server.close();
    }
  });
});
