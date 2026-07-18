import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { departments } from "../../src/db/schema/departments";

describe("Department hierarchy validation on /tenants/:id/departments (spec FR-007, research.md §1)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("rejects nesting a 4th level deep", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { grandchildId } = await withTenantDb(tenantId, async (db) => {
      const [root] = await db
        .insert(departments)
        .values({ tenantId, name: `Root ${randomUUID()}`, status: "active" })
        .returning({ id: departments.id });
      const [child] = await db
        .insert(departments)
        .values({ tenantId, name: `Child ${randomUUID()}`, status: "active", parentDepartmentId: root.id })
        .returning({ id: departments.id });
      const [grandchild] = await db
        .insert(departments)
        .values({ tenantId, name: `Grandchild ${randomUUID()}`, status: "active", parentDepartmentId: child.id })
        .returning({ id: departments.id });
      return { grandchildId: grandchild.id };
    });

    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/departments`,
        headers: { cookie: cookieHeader },
        payload: { name: `Great-Grandchild ${randomUUID()}`, parentDepartmentId: grandchildId },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().message).toMatch(/3 levels/i);
    } finally {
      await server.close();
    }
  });

  it("rejects a parentDepartmentId belonging to a different tenant, as not found", async () => {
    const tenantId = randomUUID();
    const otherTenantId = randomUUID();
    await seedTenant(tenantId);
    await seedTenant(otherTenantId);
    const otherParentId = await withTenantDb(otherTenantId, async (db) => {
      const [dept] = await db
        .insert(departments)
        .values({ tenantId: otherTenantId, name: `Other Root ${randomUUID()}`, status: "active" })
        .returning({ id: departments.id });
      return dept.id;
    });

    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/departments`,
        headers: { cookie: cookieHeader },
        payload: { name: `Child ${randomUUID()}`, parentDepartmentId: otherParentId },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().message).toMatch(/parent department not found/i);
    } finally {
      await server.close();
    }
  });
});
