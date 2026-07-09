import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole, seedRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";
import { userRoles } from "../../src/db/schema/roles";

describe("PATCH /tenant/team/:userId (spec 013 US2, FR-006)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("updates fullName, role (single-row user_roles update), and department", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const editorId = randomUUID();
    await withTenantDb(tenantId, async (db) => {
      await db.insert(users).values({ id: editorId, tenantId, fullName: "Editor", email: `editor-${randomUUID()}@example.com` });
    });
    await seedUserWithRole(tenantId, editorId, ["team.edit"]);

    const { roleId: roleA } = await seedRole(tenantId, "Role A", []);
    const { roleId: roleB } = await seedRole(tenantId, "Role B", []);
    const { memberId, deptB } = await withTenantDb(tenantId, async (db) => {
      const [deptA] = await db.insert(departments).values({ tenantId, name: `Dept A ${randomUUID()}` }).returning({ id: departments.id });
      const [deptB] = await db.insert(departments).values({ tenantId, name: `Dept B ${randomUUID()}` }).returning({ id: departments.id });
      const [member] = await db
        .insert(users)
        .values({ tenantId, fullName: "Original Name", email: `member-${randomUUID()}@example.com`, departmentId: deptA.id })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId, userId: member.id, roleId: roleA });
      return { memberId: member.id, deptB: deptB.id };
    });

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenant/team/${memberId}`,
        headers: { "x-test-user-id": editorId, "x-test-tenant-id": tenantId },
        payload: { fullName: "Updated Name", roleId: roleB, departmentId: deptB },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toMatchObject({ fullName: "Updated Name", roleName: "Role B", departmentName: expect.stringContaining("Dept B") });

      const roleRows = await withTenantDb(tenantId, async (db) => {
        return db.select().from(userRoles).where(eq(userRoles.userId, memberId));
      });
      expect(roleRows).toHaveLength(1);
      expect(roleRows[0].roleId).toBe(roleB);
    } finally {
      await server.close();
    }
  });

  it("departmentId: null clears the assignment; an omitted field leaves it untouched", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const editorId = randomUUID();
    await withTenantDb(tenantId, async (db) => {
      await db.insert(users).values({ id: editorId, tenantId, fullName: "Editor", email: `editor-${randomUUID()}@example.com` });
    });
    await seedUserWithRole(tenantId, editorId, ["team.edit"]);
    const { roleId } = await seedRole(tenantId, "Employee", []);

    const memberId = await withTenantDb(tenantId, async (db) => {
      const [dept] = await db.insert(departments).values({ tenantId, name: `Dept ${randomUUID()}` }).returning({ id: departments.id });
      const [member] = await db
        .insert(users)
        .values({ tenantId, fullName: "Member", email: `member-${randomUUID()}@example.com`, departmentId: dept.id })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId, userId: member.id, roleId });
      return member.id;
    });

    const server = await buildTestServer();
    try {
      const omitted = await server.inject({
        method: "PATCH",
        url: `/tenant/team/${memberId}`,
        headers: { "x-test-user-id": editorId, "x-test-tenant-id": tenantId },
        payload: { fullName: "Still Same Department" },
      });
      expect(omitted.statusCode).toBe(200);
      expect(omitted.json().data.departmentName).toBeTruthy();

      const cleared = await server.inject({
        method: "PATCH",
        url: `/tenant/team/${memberId}`,
        headers: { "x-test-user-id": editorId, "x-test-tenant-id": tenantId },
        payload: { departmentId: null },
      });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json().data.departmentName).toBeNull();
    } finally {
      await server.close();
    }
  });

  it("rejects an unknown roleId or an archived department, leaving the member's existing data unchanged", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const editorId = randomUUID();
    await withTenantDb(tenantId, async (db) => {
      await db.insert(users).values({ id: editorId, tenantId, fullName: "Editor", email: `editor-${randomUUID()}@example.com` });
    });
    await seedUserWithRole(tenantId, editorId, ["team.edit"]);
    const { roleId } = await seedRole(tenantId, "Employee", []);

    const { memberId, archivedDeptId } = await withTenantDb(tenantId, async (db) => {
      const [archivedDept] = await db
        .insert(departments)
        .values({ tenantId, name: `Archived ${randomUUID()}`, status: "archived" })
        .returning({ id: departments.id });
      const [member] = await db
        .insert(users)
        .values({ tenantId, fullName: "Unchanged Name", email: `member-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId, userId: member.id, roleId });
      return { memberId: member.id, archivedDeptId: archivedDept.id };
    });

    const server = await buildTestServer();
    try {
      const badRole = await server.inject({
        method: "PATCH",
        url: `/tenant/team/${memberId}`,
        headers: { "x-test-user-id": editorId, "x-test-tenant-id": tenantId },
        payload: { fullName: "Should Not Apply", roleId: randomUUID() },
      });
      expect(badRole.statusCode).toBe(422);
      expect(badRole.json()).toMatchObject({ success: false, message: "Role not found" });

      const badDept = await server.inject({
        method: "PATCH",
        url: `/tenant/team/${memberId}`,
        headers: { "x-test-user-id": editorId, "x-test-tenant-id": tenantId },
        payload: { departmentId: archivedDeptId },
      });
      expect(badDept.statusCode).toBe(422);
      expect(badDept.json()).toMatchObject({ success: false, message: "Department not found or not active" });

      const unchanged = await withTenantDb(tenantId, async (db) => {
        const [row] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, memberId));
        return row;
      });
      expect(unchanged.fullName).toBe("Unchanged Name");
    } finally {
      await server.close();
    }
  });
});
