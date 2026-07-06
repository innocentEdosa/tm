import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";

describe("department deletion blocked by assigned members, subtree rollup (spec FR-008/FR-016)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("blocks deleting a department with a direct member, reporting the correct count", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["department.manage"]);

    const deptId = await withTenantDb(tenantId, async (db) => {
      const [dept] = await db
        .insert(departments)
        .values({ tenantId, name: `Dept ${randomUUID()}` })
        .returning({ id: departments.id });
      await db.insert(users).values({
        tenantId,
        fullName: "Member Person",
        email: `member-${randomUUID()}@example.com`,
        departmentId: dept.id,
      });
      return dept.id;
    });

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "DELETE",
        url: `/tenant/departments/${deptId}`,
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(409);
      const body = response.json();
      expect(body.reason).toBe("has_members");
      expect(body.memberCount).toBe(1);
      expect(body.membersListHref).toContain(deptId);
    } finally {
      await server.close();
    }
  });

  it("blocks deleting an ancestor whose descendant has the member (subtree rollup)", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["department.manage"]);

    const { divisionId } = await withTenantDb(tenantId, async (db) => {
      const [division] = await db
        .insert(departments)
        .values({ tenantId, name: `Division ${randomUUID()}` })
        .returning({ id: departments.id });
      const [team] = await db
        .insert(departments)
        .values({ tenantId, name: `Team ${randomUUID()}`, parentDepartmentId: division.id })
        .returning({ id: departments.id });
      await db.insert(users).values({
        tenantId,
        fullName: "Team Member",
        email: `team-member-${randomUUID()}@example.com`,
        departmentId: team.id,
      });
      return { divisionId: division.id };
    });

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "DELETE",
        url: `/tenant/departments/${divisionId}`,
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(409);
      const body = response.json();
      expect(body.reason).toBe("has_members");
      expect(body.memberCount).toBe(1);
    } finally {
      await server.close();
    }
  });
});
