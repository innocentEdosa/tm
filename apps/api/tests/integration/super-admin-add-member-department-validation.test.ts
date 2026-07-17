import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { departments } from "../../src/db/schema/departments";

describe("POST /tenants/:id/members — department validation (spec FR-003, research.md §1)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns 422 for an archived department in the same tenant", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    const deptId = await withTenantDb(tenantId, async (db) => {
      const [dept] = await db
        .insert(departments)
        .values({ tenantId, name: `Archived Dept ${randomUUID()}`, status: "archived" })
        .returning({ id: departments.id });
      return dept.id;
    });
    const { cookieHeader } = await seedSuperAdminSession();

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/members`,
        headers: { cookie: cookieHeader },
        payload: { fullName: "X", email: `x-${randomUUID()}@example.com`, roleId, departmentId: deptId },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().message).toBe("Department not found or not active");
    } finally {
      await server.close();
    }
  });

  it("returns 422 for an active department belonging to a different tenant", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    await seedTenant(tenantA);
    await seedTenant(tenantB);
    const { roleId } = await seedRole(tenantA, `Role A ${randomUUID()}`);
    const deptBId = await withTenantDb(tenantB, async (db) => {
      const [dept] = await db
        .insert(departments)
        .values({ tenantId: tenantB, name: `Dept B ${randomUUID()}` })
        .returning({ id: departments.id });
      return dept.id;
    });
    const { cookieHeader } = await seedSuperAdminSession();

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/tenants/${tenantA}/members`,
        headers: { cookie: cookieHeader },
        payload: { fullName: "X", email: `x-${randomUUID()}@example.com`, roleId, departmentId: deptBId },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().message).toBe("Department not found or not active");
    } finally {
      await server.close();
    }
  });
});
