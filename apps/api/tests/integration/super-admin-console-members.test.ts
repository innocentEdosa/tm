import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { users } from "../../src/db/schema/users";
import { departments } from "../../src/db/schema/departments";
import { userRoles } from "../../src/db/schema/roles";

describe("GET /tenants/:id/members (spec FR-006)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns the documented row shape", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);

    const member = await withTenantDb(tenantId, async (db) => {
      const [dept] = await db
        .insert(departments)
        .values({ tenantId, name: `Dept ${randomUUID()}` })
        .returning({ id: departments.id });
      const [member] = await db
        .insert(users)
        .values({
          tenantId,
          fullName: "Invited Person",
          email: `invited-${randomUUID()}@example.com`,
          departmentId: dept.id,
          mustChangePassword: true,
        })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId, userId: member.id, roleId });
      return member;
    });

    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: `/tenants/${tenantId}/members`,
        headers: { cookie: cookieHeader },
      });
      expect(response.statusCode).toBe(200);
      const row = response.json().data.find((m: { id: string }) => m.id === member.id);
      expect(row).toMatchObject({
        fullName: "Invited Person",
        accountStatus: "invited",
      });
      expect(row.departmentName).toBeTruthy();
    } finally {
      await server.close();
    }
  });

  it("honors search and pagination", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    const unique = randomUUID();

    const memberIds = await withTenantDb(tenantId, async (db) => {
      const ids: string[] = [];
      const [zelda] = await db
        .insert(users)
        .values({ tenantId, fullName: `Zelda Unique${unique}`, email: `zelda-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      ids.push(zelda.id);
      for (let i = 0; i < 3; i++) {
        const [m] = await db
          .insert(users)
          .values({ tenantId, fullName: `Page Member ${i}`, email: `page-${i}-${randomUUID()}@example.com` })
          .returning({ id: users.id });
        ids.push(m.id);
      }
      for (const id of ids) {
        await db.insert(userRoles).values({ tenantId, userId: id, roleId });
      }
      return ids;
    });

    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const searchResponse = await server.inject({
        method: "GET",
        url: `/tenants/${tenantId}/members?search=${encodeURIComponent(`unique${unique}`)}`,
        headers: { cookie: cookieHeader },
      });
      expect(searchResponse.statusCode).toBe(200);
      const searchData = searchResponse.json().data;
      expect(searchData).toHaveLength(1);
      expect(searchData[0].id).toBe(memberIds[0]);

      const pageResponse = await server.inject({
        method: "GET",
        url: `/tenants/${tenantId}/members?page=1&pageSize=2`,
        headers: { cookie: cookieHeader },
      });
      expect(pageResponse.statusCode).toBe(200);
      const pageBody = pageResponse.json();
      expect(pageBody.data).toHaveLength(2);
      expect(pageBody.meta).toMatchObject({ page: 1, pageSize: 2, total: 4 });
    } finally {
      await server.close();
    }
  });

  it("returns an empty array (not an error) for a tenant with zero members", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { cookieHeader } = await seedSuperAdminSession();

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: `/tenants/${tenantId}/members`,
        headers: { cookie: cookieHeader },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual([]);
      expect(response.json().meta.total).toBe(0);
    } finally {
      await server.close();
    }
  });
});
