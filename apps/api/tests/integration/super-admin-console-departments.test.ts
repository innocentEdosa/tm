import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";

describe("GET /tenants/:id/departments (spec FR-004)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns the documented row shape including manager/assistantManager/memberCount/hasChildren", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);

    const { parent, child, manager } = await withTenantDb(tenantId, async (db) => {
      const [manager] = await db
        .insert(users)
        .values({ tenantId, fullName: "Manny Manager", email: `manny-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      const [parent] = await db
        .insert(departments)
        .values({ tenantId, name: `Parent ${randomUUID()}`, managerId: manager.id })
        .returning({ id: departments.id });
      const [child] = await db
        .insert(departments)
        .values({ tenantId, name: `Child ${randomUUID()}`, parentDepartmentId: parent.id })
        .returning({ id: departments.id });
      await db.update(users).set({ departmentId: child.id }).where(eq(users.id, manager.id));
      return { parent, child, manager };
    });

    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: `/tenants/${tenantId}/departments`,
        headers: { cookie: cookieHeader },
      });
      expect(response.statusCode).toBe(200);
      const data = response.json().data as Array<Record<string, unknown>>;

      const parentRow = data.find((d) => d.id === parent.id);
      expect(parentRow).toMatchObject({
        parentDepartmentId: null,
        hasChildren: true,
        manager: { id: manager.id, fullName: "Manny Manager" },
        assistantManager: null,
      });

      const childRow = data.find((d) => d.id === child.id);
      expect(childRow).toMatchObject({
        parentDepartmentId: parent.id,
        hasChildren: false,
        memberCount: 1,
      });
    } finally {
      await server.close();
    }
  });

  it("returns an empty array (not an error) for a tenant with zero departments", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { cookieHeader } = await seedSuperAdminSession();

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: `/tenants/${tenantId}/departments`,
        headers: { cookie: cookieHeader },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual([]);
    } finally {
      await server.close();
    }
  });
});
