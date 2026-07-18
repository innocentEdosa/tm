import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { departments } from "../../src/db/schema/departments";

describe("/tenants/:id/departments(/:departmentId) — forbidden without a Super Admin session (spec FR-011)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("401s POST/PATCH without a session", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const departmentId = await withTenantDb(tenantId, async (db) => {
      const [dept] = await db
        .insert(departments)
        .values({ tenantId, name: `Dept ${randomUUID()}`, status: "active" })
        .returning({ id: departments.id });
      return dept.id;
    });
    const server = await buildTestServer();
    try {
      const post = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/departments`,
        payload: { name: "X" },
      });
      expect(post.statusCode).toBe(401);

      const patch = await server.inject({
        method: "PATCH",
        url: `/tenants/${tenantId}/departments/${departmentId}`,
        payload: { description: "X" },
      });
      expect(patch.statusCode).toBe(401);
    } finally {
      await server.close();
    }
  });
});
