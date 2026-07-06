import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";

describe("department hierarchy: cycle prevention and depth cap (spec FR-005/FR-006)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  async function seedThreeLevelChain(tenantId: string) {
    return withTenantDb(tenantId, async (db) => {
      const [org] = await db
        .insert(departments)
        .values({ tenantId, name: `Org ${randomUUID()}` })
        .returning({ id: departments.id });
      const [division] = await db
        .insert(departments)
        .values({ tenantId, name: `Division ${randomUUID()}`, parentDepartmentId: org.id })
        .returning({ id: departments.id });
      const [team] = await db
        .insert(departments)
        .values({ tenantId, name: `Team ${randomUUID()}`, parentDepartmentId: division.id })
        .returning({ id: departments.id });
      return { orgId: org.id, divisionId: division.id, teamId: team.id };
    });
  }

  it("rejects setting a department's parent to its own descendant (cycle)", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["department.manage"]);
    const { orgId, teamId } = await seedThreeLevelChain(tenantId);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenant/departments/${orgId}`,
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
        payload: { parentDepartmentId: teamId },
      });
      expect(response.statusCode).toBe(422);
    } finally {
      await server.close();
    }
  });

  it("rejects creating a 4th-level department (depth cap)", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["department.manage"]);
    const { teamId } = await seedThreeLevelChain(tenantId);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/tenant/departments",
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
        payload: { name: `Fourth Level ${randomUUID()}`, parentDepartmentId: teamId },
      });
      expect(response.statusCode).toBe(422);
    } finally {
      await server.close();
    }
  });
});
