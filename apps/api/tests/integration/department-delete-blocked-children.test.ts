import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";

describe("department deletion blocked by child departments (spec FR-008)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("blocks deleting a department that has a child, with no members anywhere in the subtree", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["department.manage"]);

    const orgId = await withTenantDb(tenantId, async (db) => {
      const [org] = await db
        .insert(departments)
        .values({ tenantId, name: `Org ${randomUUID()}` })
        .returning({ id: departments.id });
      await db.insert(departments).values({
        tenantId,
        name: `Division ${randomUUID()}`,
        parentDepartmentId: org.id,
      });
      return org.id;
    });

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "DELETE",
        url: `/tenant/departments/${orgId}`,
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(409);
      const body = response.json();
      expect(body.reason).toBe("has_children");
    } finally {
      await server.close();
    }
  });
});
