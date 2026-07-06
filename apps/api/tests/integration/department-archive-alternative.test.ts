import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";

describe("archiving a department succeeds even while blocked from deletion (spec FR-009)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("archives a department that still has a member and a child department", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["department.manage"]);

    const deptId = await withTenantDb(tenantId, async (db) => {
      const [dept] = await db
        .insert(departments)
        .values({ tenantId, name: `Dept ${randomUUID()}` })
        .returning({ id: departments.id });
      await db.insert(departments).values({
        tenantId,
        name: `Child ${randomUUID()}`,
        parentDepartmentId: dept.id,
      });
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
      // Deletion is blocked (member present) ...
      const deleteAttempt = await server.inject({
        method: "DELETE",
        url: `/tenant/departments/${deptId}`,
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
      });
      expect(deleteAttempt.statusCode).toBe(409);

      // ... but archiving succeeds regardless.
      const archive = await server.inject({
        method: "PATCH",
        url: `/tenant/departments/${deptId}`,
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
        payload: { status: "archived" },
      });
      expect(archive.statusCode).toBe(200);
      expect(archive.json().data.status).toBe("archived");
    } finally {
      await server.close();
    }
  });
});
