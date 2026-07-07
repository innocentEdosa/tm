import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole, seedRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";
import { userRoles, roles } from "../../src/db/schema/roles";

describe("GET /tenant/team — department-scoped visibility (spec 012 US2, FR-003, SC-002/SC-004)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("a team.view.department holder sees only their own department's subtree, even via a crafted departmentId param", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);

    const { parentId, childId, unrelatedId, viewerId, parentMemberId, childMemberId, unrelatedMemberId } =
      await withTenantDb(tenantId, async (db) => {
        const [parent] = await db.insert(departments).values({ tenantId, name: `Parent ${randomUUID()}` }).returning({ id: departments.id });
        const [child] = await db
          .insert(departments)
          .values({ tenantId, name: `Child ${randomUUID()}`, parentDepartmentId: parent.id })
          .returning({ id: departments.id });
        const [unrelated] = await db.insert(departments).values({ tenantId, name: `Unrelated ${randomUUID()}` }).returning({ id: departments.id });

        const [viewer] = await db
          .insert(users)
          .values({ tenantId, fullName: "Dept Viewer", email: `viewer-${randomUUID()}@example.com`, departmentId: parent.id })
          .returning({ id: users.id });
        const [parentMember] = await db
          .insert(users)
          .values({ tenantId, fullName: "Parent Member", email: `parent-${randomUUID()}@example.com`, departmentId: parent.id })
          .returning({ id: users.id });
        const [childMember] = await db
          .insert(users)
          .values({ tenantId, fullName: "Child Member", email: `child-${randomUUID()}@example.com`, departmentId: child.id })
          .returning({ id: users.id });
        const [unrelatedMember] = await db
          .insert(users)
          .values({ tenantId, fullName: "Unrelated Member", email: `unrelated-${randomUUID()}@example.com`, departmentId: unrelated.id })
          .returning({ id: users.id });

        return {
          parentId: parent.id,
          childId: child.id,
          unrelatedId: unrelated.id,
          viewerId: viewer.id,
          parentMemberId: parentMember.id,
          childMemberId: childMember.id,
          unrelatedMemberId: unrelatedMember.id,
        };
      });

    const { roleId } = await seedRole(tenantId, "Employee", []);
    await withTenantDb(tenantId, async (db) => {
      for (const id of [viewerId, parentMemberId, childMemberId, unrelatedMemberId]) {
        await db.insert(userRoles).values({ tenantId, userId: id, roleId });
      }
    });
    await seedUserWithRole(tenantId, viewerId, ["team.view.department"]);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: "/tenant/team",
        headers: { "x-test-user-id": viewerId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(200);
      const ids = response.json().data.map((m: { id: string }) => m.id);
      expect(ids).toEqual(expect.arrayContaining([viewerId, parentMemberId, childMemberId]));
      expect(ids).not.toContain(unrelatedMemberId);

      // The security-critical assertion (SC-002/SC-004): a crafted departmentId param naming an
      // unrelated department must NOT expand or redirect this caller's scope.
      const crafted = await server.inject({
        method: "GET",
        url: `/tenant/team?departmentId=${unrelatedId}`,
        headers: { "x-test-user-id": viewerId, "x-test-tenant-id": tenantId },
      });
      expect(crafted.statusCode).toBe(200);
      const craftedIds = crafted.json().data.map((m: { id: string }) => m.id);
      expect(craftedIds).not.toContain(unrelatedMemberId);
      expect(craftedIds).toEqual(expect.arrayContaining([viewerId, parentMemberId, childMemberId]));
    } finally {
      await server.close();
    }
  });
});
