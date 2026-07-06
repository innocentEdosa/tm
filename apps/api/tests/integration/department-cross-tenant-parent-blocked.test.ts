import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";

describe("department parent cannot cross a tenant boundary (spec FR-005/FR-007)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("PATCH referencing another tenant's department as parent behaves as not-found (422)", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    await seedTenant(tenantA);
    await seedTenant(tenantB);

    const adminA = randomUUID();
    await seedUserWithRole(tenantA, adminA, ["department.manage"]);

    const deptA = await withTenantDb(tenantA, async (db) => {
      const [row] = await db
        .insert(departments)
        .values({ tenantId: tenantA, name: `A Dept ${randomUUID()}` })
        .returning({ id: departments.id });
      return row;
    });

    const deptB = await withTenantDb(tenantB, async (db) => {
      const [row] = await db
        .insert(departments)
        .values({ tenantId: tenantB, name: `B Dept ${randomUUID()}` })
        .returning({ id: departments.id });
      return row;
    });

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenant/departments/${deptA.id}`,
        headers: { "x-test-user-id": adminA, "x-test-tenant-id": tenantA },
        payload: { parentDepartmentId: deptB.id },
      });
      expect(response.statusCode).toBe(422);
    } finally {
      await server.close();
    }
  });
});
