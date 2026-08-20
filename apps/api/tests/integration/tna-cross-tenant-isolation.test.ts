import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";

/** RLS tenant-isolation boundary for the new `tna_exercises`/`tna_exercise_targets`/`tna_assignments`
 * tables — a `tna.manage` holder in one tenant must never be able to read, edit, or act on another
 * tenant's exercise or assignment id, even when they hold the exact same permission. */
describe("TNA: cross-tenant isolation", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("an exercise id from another tenant returns 404 for every admin route", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["tna.manage"]);

    const otherTenantId = randomUUID();
    await seedTenant(otherTenantId);
    const otherAdminId = randomUUID();
    await seedUser(otherTenantId, otherAdminId);
    await seedUserWithRole(otherTenantId, otherAdminId, ["tna.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const created = await server.inject({
        method: "POST",
        url: "/tenant/tna-exercises",
        headers,
        payload: { title: "Tenant A Exercise", endDate: "2099-12-31", targetsAllDepartments: true },
      });
      const exerciseId = created.json().data.id;

      const otherHeaders = { "x-test-user-id": otherAdminId, "x-test-tenant-id": otherTenantId };
      const get = await server.inject({ method: "GET", url: `/tenant/tna-exercises/${exerciseId}`, headers: otherHeaders });
      expect(get.statusCode).toBe(404);

      const patch = await server.inject({
        method: "PATCH",
        url: `/tenant/tna-exercises/${exerciseId}`,
        headers: otherHeaders,
        payload: { title: "Hijacked" },
      });
      expect(patch.statusCode).toBe(404);

      const start = await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/start`, headers: otherHeaders });
      expect(start.statusCode).toBe(404);

      const del = await server.inject({ method: "DELETE", url: `/tenant/tna-exercises/${exerciseId}`, headers: otherHeaders });
      expect(del.statusCode).toBe(404);

      // And it must remain completely untouched in its own tenant.
      const stillThere = await server.inject({ method: "GET", url: `/tenant/tna-exercises/${exerciseId}`, headers });
      expect(stillThere.json().data.title).toBe("Tenant A Exercise");
      expect(stillThere.json().data.status).toBe("draft");
    } finally {
      await server.close();
    }
  });

  it("an assignment id from another tenant is invisible even to that tenant's own permission holder", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["tna.manage"]);

    const { deptId } = await withTenantDb(tenantId, async (db) => {
      const [manager] = await db.insert(users).values({ tenantId, fullName: "Manager", email: `m-${randomUUID()}@example.com` }).returning({ id: users.id });
      const [dept] = await db.insert(departments).values({ tenantId, name: `Dept ${randomUUID()}`, managerId: manager.id }).returning({ id: departments.id });
      return { deptId: dept.id };
    });

    const otherTenantId = randomUUID();
    await seedTenant(otherTenantId);
    const otherAdminId = randomUUID();
    await seedUser(otherTenantId, otherAdminId);
    await seedUserWithRole(otherTenantId, otherAdminId, ["tna.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const created = await server.inject({
        method: "POST",
        url: "/tenant/tna-exercises",
        headers,
        payload: { title: "Tenant A Exercise", endDate: "2099-12-31", targets: [{ type: "department", departmentId: deptId }] },
      });
      const exerciseId = created.json().data.id;
      await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/start`, headers });
      const assignments = await server.inject({ method: "GET", url: `/tenant/tna-exercises/${exerciseId}/assignments`, headers });
      const assignmentId = assignments.json().data[0].id;

      const otherHeaders = { "x-test-user-id": otherAdminId, "x-test-tenant-id": otherTenantId };
      const get = await server.inject({ method: "GET", url: `/tenant/tna-assignments/${assignmentId}`, headers: otherHeaders });
      expect(get.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });
});
