import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";
import { userRoles } from "../../src/db/schema/roles";

describe("Super Admin Tenant Console — remains fully available regardless of tenant status (spec FR-013)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("all four read routes still return 200 with unchanged data after the tenant is archived", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId, `Archived Read Test ${tenantId}`);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    await withTenantDb(tenantId, async (db) => {
      await db.insert(departments).values({ tenantId, name: `Dept ${randomUUID()}` });
      const [member] = await db
        .insert(users)
        .values({
          tenantId,
          fullName: "Some Member",
          email: `member-${randomUUID()}@example.com`,
        })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId, userId: member.id, roleId });
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

      const detail = await server.inject({
        method: "GET",
        url: `/tenants/${tenantId}`,
        headers: { cookie: cookieHeader },
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().data.isArchived).toBe(true);

      const dept = await server.inject({
        method: "GET",
        url: `/tenants/${tenantId}/departments`,
        headers: { cookie: cookieHeader },
      });
      expect(dept.statusCode).toBe(200);
      expect(dept.json().data).toHaveLength(1);

      const roles = await server.inject({
        method: "GET",
        url: `/tenants/${tenantId}/roles`,
        headers: { cookie: cookieHeader },
      });
      expect(roles.statusCode).toBe(200);

      const members = await server.inject({
        method: "GET",
        url: `/tenants/${tenantId}/members`,
        headers: { cookie: cookieHeader },
      });
      expect(members.statusCode).toBe(200);
      expect(members.json().data).toHaveLength(1);
    } finally {
      await server.close();
    }
  });
});
