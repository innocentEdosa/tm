import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";

describe("department Manager / Assistant Manager assignment (spec FR-019/FR-020/FR-021)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("accepts any tenant user as Manager/Assistant Manager, not just members of that department", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["department.manage"]);

    const { managerId, assistantManagerId } = await withTenantDb(tenantId, async (db) => {
      const [manager] = await db
        .insert(users)
        .values({ tenantId, fullName: "Manager Person", email: `manager-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      const [assistant] = await db
        .insert(users)
        .values({ tenantId, fullName: "Assistant Person", email: `assistant-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      return { managerId: manager.id, assistantManagerId: assistant.id };
    });

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/tenant/departments",
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
        payload: { name: `Dept ${randomUUID()}`, managerId, assistantManagerId },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data.manager).toBeNull();
      expect(body.data.assistantManager).toBeNull();
    } finally {
      await server.close();
    }

    const saved = await withTenantDb(tenantId, async (db) => {
      const rows = await db
        .select({ managerId: departments.managerId, assistantManagerId: departments.assistantManagerId })
        .from(departments)
        .where(eq(departments.managerId, managerId));
      return rows[0];
    });
    expect(saved?.managerId).toBe(managerId);
    expect(saved?.assistantManagerId).toBe(assistantManagerId);
  });

  it("rejects the same person as both Manager and Assistant Manager", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["department.manage"]);

    const personId = await withTenantDb(tenantId, async (db) => {
      const [person] = await db
        .insert(users)
        .values({ tenantId, fullName: "Same Person", email: `person-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      return person.id;
    });

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/tenant/departments",
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
        payload: { name: `Dept ${randomUUID()}`, managerId: personId, assistantManagerId: personId },
      });
      expect(response.statusCode).toBe(422);
    } finally {
      await server.close();
    }
  });

  it("GET /tenant/users requires a non-empty search and is gated by department.manage", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const managerAdminId = randomUUID();
    await seedUserWithRole(tenantId, managerAdminId, ["department.manage"]);
    const viewOnlyId = randomUUID();
    await seedUserWithRole(tenantId, viewOnlyId, ["department.view"]);

    const server = await buildTestServer();
    try {
      const noSearch = await server.inject({
        method: "GET",
        url: "/tenant/users",
        headers: { "x-test-user-id": managerAdminId, "x-test-tenant-id": tenantId },
      });
      expect(noSearch.statusCode).toBe(400);

      const withSearch = await server.inject({
        method: "GET",
        url: "/tenant/users?search=a",
        headers: { "x-test-user-id": managerAdminId, "x-test-tenant-id": tenantId },
      });
      expect(withSearch.statusCode).toBe(200);

      const deniedForViewOnly = await server.inject({
        method: "GET",
        url: "/tenant/users?search=a",
        headers: { "x-test-user-id": viewOnlyId, "x-test-tenant-id": tenantId },
      });
      expect(deniedForViewOnly.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("deletes successfully despite a Manager/Assistant Manager assignment, with no members or children (FR-021)", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["department.manage"]);

    const { deptId } = await withTenantDb(tenantId, async (db) => {
      const [manager] = await db
        .insert(users)
        .values({ tenantId, fullName: "Manager Person", email: `manager-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      const [dept] = await db
        .insert(departments)
        .values({ tenantId, name: `Dept ${randomUUID()}`, managerId: manager.id })
        .returning({ id: departments.id });
      return { deptId: dept.id };
    });

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "DELETE",
        url: `/tenant/departments/${deptId}`,
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });
});
