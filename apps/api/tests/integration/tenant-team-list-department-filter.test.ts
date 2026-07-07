import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole, seedRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";
import { userRoles } from "../../src/db/schema/roles";

describe("GET /tenant/team — department filter for org-wide viewers (spec 012 US3, FR-009)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("selecting a parent department includes its descendants and excludes unrelated departments", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const viewerId = randomUUID();
    await seedUserWithRole(tenantId, viewerId, ["team.view.all"]);
    const { roleId } = await seedRole(tenantId, "Employee", []);

    const { parentId, parentMemberId, childMemberId, unrelatedMemberId } = await withTenantDb(tenantId, async (db) => {
      const [parent] = await db.insert(departments).values({ tenantId, name: `Parent ${randomUUID()}` }).returning({ id: departments.id });
      const [child] = await db
        .insert(departments)
        .values({ tenantId, name: `Child ${randomUUID()}`, parentDepartmentId: parent.id })
        .returning({ id: departments.id });
      const [unrelated] = await db.insert(departments).values({ tenantId, name: `Unrelated ${randomUUID()}` }).returning({ id: departments.id });

      const [parentMember] = await db
        .insert(users)
        .values({ tenantId, fullName: "Parent Member", email: `pm-${randomUUID()}@example.com`, departmentId: parent.id })
        .returning({ id: users.id });
      const [childMember] = await db
        .insert(users)
        .values({ tenantId, fullName: "Child Member", email: `cm-${randomUUID()}@example.com`, departmentId: child.id })
        .returning({ id: users.id });
      const [unrelatedMember] = await db
        .insert(users)
        .values({ tenantId, fullName: "Unrelated Member", email: `um-${randomUUID()}@example.com`, departmentId: unrelated.id })
        .returning({ id: users.id });

      for (const id of [parentMember.id, childMember.id, unrelatedMember.id]) {
        await db.insert(userRoles).values({ tenantId, userId: id, roleId });
      }

      return { parentId: parent.id, parentMemberId: parentMember.id, childMemberId: childMember.id, unrelatedMemberId: unrelatedMember.id };
    });

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: `/tenant/team?departmentId=${parentId}`,
        headers: { "x-test-user-id": viewerId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(200);
      const ids = response.json().data.map((m: { id: string }) => m.id);
      expect(ids).toEqual(expect.arrayContaining([parentMemberId, childMemberId]));
      expect(ids).not.toContain(unrelatedMemberId);
    } finally {
      await server.close();
    }
  });
});
