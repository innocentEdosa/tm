import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole, seedRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";

describe("POST /tenant-auth/team — role/department validation (spec 013 US1, FR-002/FR-003/FR-005)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("rejects an unknown roleId with a clean 422, leaving no user row behind", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await withTenantDb(tenantId, async (db) => {
      await db.insert(users).values({ id: adminId, tenantId, fullName: "Admin", email: `admin-${randomUUID()}@example.com` });
    });
    await seedUserWithRole(tenantId, adminId, ["manage_team_members"]);

    const email = `newmember-${randomUUID()}@example.com`;
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/tenant-auth/team",
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
        payload: { fullName: "New Member", email, roleId: randomUUID() },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ success: false, message: "Role not found" });

      const row = await withTenantDb(tenantId, async (db) => {
        return db.select({ id: users.id }).from(users).where(eq(users.email, email));
      });
      expect(row).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("rejects an archived department and a different tenant's department, both before any write", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await withTenantDb(tenantId, async (db) => {
      await db.insert(users).values({ id: adminId, tenantId, fullName: "Admin", email: `admin-${randomUUID()}@example.com` });
    });
    await seedUserWithRole(tenantId, adminId, ["manage_team_members"]);
    const { roleId } = await seedRole(tenantId, "Employee", []);

    const archivedDeptId = await withTenantDb(tenantId, async (db) => {
      const [dept] = await db
        .insert(departments)
        .values({ tenantId, name: `Archived ${randomUUID()}`, status: "archived" })
        .returning({ id: departments.id });
      return dept.id;
    });

    const otherTenantId = randomUUID();
    await seedTenant(otherTenantId);
    const otherTenantDeptId = await withTenantDb(otherTenantId, async (db) => {
      const [dept] = await db.insert(departments).values({ tenantId: otherTenantId, name: `Other ${randomUUID()}` }).returning({ id: departments.id });
      return dept.id;
    });

    const server = await buildTestServer();
    try {
      const archivedResponse = await server.inject({
        method: "POST",
        url: "/tenant-auth/team",
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
        payload: { fullName: "New Member", email: `archived-${randomUUID()}@example.com`, roleId, departmentId: archivedDeptId },
      });
      expect(archivedResponse.statusCode).toBe(422);
      expect(archivedResponse.json()).toMatchObject({ success: false, message: "Department not found or not active" });

      const crossTenantResponse = await server.inject({
        method: "POST",
        url: "/tenant-auth/team",
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
        payload: { fullName: "New Member", email: `cross-${randomUUID()}@example.com`, roleId, departmentId: otherTenantDeptId },
      });
      expect(crossTenantResponse.statusCode).toBe(422);
      expect(crossTenantResponse.json()).toMatchObject({ success: false, message: "Department not found or not active" });
    } finally {
      await server.close();
    }
  });
});
