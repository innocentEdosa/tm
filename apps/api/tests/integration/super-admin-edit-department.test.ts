import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";

describe("PATCH /tenants/:id/departments/:departmentId (spec FR-007)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("edits name, description, status, and Manager", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { departmentId, managerId } = await withTenantDb(tenantId, async (db) => {
      const [dept] = await db
        .insert(departments)
        .values({ tenantId, name: `Original ${randomUUID()}`, status: "active" })
        .returning({ id: departments.id });
      const [manager] = await db
        .insert(users)
        .values({ tenantId, fullName: "New Manager", email: `mgr-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      return { departmentId: dept.id, managerId: manager.id };
    });

    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenants/${tenantId}/departments/${departmentId}`,
        headers: { cookie: cookieHeader },
        payload: { description: "Edited via console", managerId },
      });
      expect(response.statusCode).toBe(200);

      const [row] = await withTenantDb(tenantId, async (db) =>
        db.select().from(departments).where(eq(departments.id, departmentId)),
      );
      expect(row.description).toBe("Edited via console");
      expect(row.managerId).toBe(managerId);
    } finally {
      await server.close();
    }
  });

  it("404s for a nonexistent departmentId", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenants/${tenantId}/departments/${randomUUID()}`,
        headers: { cookie: cookieHeader },
        payload: { description: "X" },
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });
});
