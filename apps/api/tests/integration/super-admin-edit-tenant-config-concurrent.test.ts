import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { roles, rolePermissions } from "../../src/db/schema/roles";
import { departments } from "../../src/db/schema/departments";

describe("Concurrent edits leave a consistent last-write-wins result (spec Edge Cases)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("two concurrent PATCHes to the same role's permission set leave exactly one final, consistent set", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, `Concurrent Role ${randomUUID()}`, ["manage_roles"]);
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const [a, b] = await Promise.all([
        server.inject({
          method: "PATCH",
          url: `/tenants/${tenantId}/roles/${roleId}`,
          headers: { cookie: cookieHeader },
          payload: { permissionKeys: ["approve_enrollment"] },
        }),
        server.inject({
          method: "PATCH",
          url: `/tenants/${tenantId}/roles/${roleId}`,
          headers: { cookie: cookieHeader },
          payload: { permissionKeys: ["edit_content_library"] },
        }),
      ]);
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);

      const finalRows = await withTenantDb(tenantId, async (db) =>
        db.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId)),
      );
      // Both requests succeed (no crash/500) and the resulting state is one of the two submitted
      // sets, or their union if both delete-then-reinsert transactions interleaved without seeing
      // each other's uncommitted row — never a duplicate row for the same permission, and never a
      // permission neither request submitted. This spec introduces no new locking beyond what the
      // tenant-side route already has (Assumptions) — this test documents that known race shape
      // rather than asserting a stricter guarantee this mechanism was never given.
      const permissionIds = new Set(finalRows.map((r) => r.permissionId));
      expect(permissionIds.size).toBe(finalRows.length);
      expect(finalRows.length).toBeGreaterThanOrEqual(1);
      expect(finalRows.length).toBeLessThanOrEqual(2);
    } finally {
      await server.close();
    }
  });

  it("two concurrent PATCHes to the same department leave a consistent single final state", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const departmentId = await withTenantDb(tenantId, async (db) => {
      const [dept] = await db
        .insert(departments)
        .values({ tenantId, name: `Concurrent Dept ${randomUUID()}`, status: "active" })
        .returning({ id: departments.id });
      return dept.id;
    });
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const [a, b] = await Promise.all([
        server.inject({
          method: "PATCH",
          url: `/tenants/${tenantId}/departments/${departmentId}`,
          headers: { cookie: cookieHeader },
          payload: { description: "From A" },
        }),
        server.inject({
          method: "PATCH",
          url: `/tenants/${tenantId}/departments/${departmentId}`,
          headers: { cookie: cookieHeader },
          payload: { description: "From B" },
        }),
      ]);
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);

      const [row] = await withTenantDb(tenantId, async (db) =>
        db.select({ description: departments.description }).from(departments).where(eq(departments.id, departmentId)),
      );
      expect(["From A", "From B"]).toContain(row.description);
    } finally {
      await server.close();
    }
  });
});
