import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

function bodyFor(subdomain: string) {
  return {
    company: {
      name: "Acme Corp",
      subdomain,
      primaryContact: { name: "Jordan Lee", email: "jordan.lee@acme.example" },
    },
    admin: { fullName: "Priya Shah", email: `priya.shah+${randomUUID()}@acme.example` },
  };
}

/** SC-003, quickstart.md Scenario 4 — through the real endpoint, not raw SQL (T012 already proved
 * RLS in isolation from application code; this proves the full provisioning flow respects it). */
describe("POST /provisioning/tenants — cross-tenant isolation through the real endpoint", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("tenant A's session sees zero of tenant B's departments/users/roles, and vice versa", async () => {
    const server = await buildTestServer();
    const { cookieHeader } = await seedSuperAdminSession();

    const resA = await server.inject({
      method: "POST",
      url: "/provisioning/tenants",
      headers: { cookie: cookieHeader },
      payload: bodyFor(`acme-a-${randomUUID()}`),
    });
    const resB = await server.inject({
      method: "POST",
      url: "/provisioning/tenants",
      headers: { cookie: cookieHeader },
      payload: bodyFor(`acme-b-${randomUUID()}`),
    });
    expect(resA.statusCode).toBe(201);
    expect(resB.statusCode).toBe(201);

    const tenantAId: string = resA.json().data.tenant.id;
    const tenantBId: string = resB.json().data.tenant.id;
    const tenantBAdminId: string = resB.json().data.admin.id;
    const tenantBDeptId: string = resB.json().data.departments[0].id;

    const seenFromA = await withTenantTransaction(tenantAId, async (client) => {
      const tenant = await client.query("SELECT id FROM tenants WHERE id = $1", [tenantBId]);
      const user = await client.query("SELECT id FROM users WHERE id = $1", [tenantBAdminId]);
      const dept = await client.query("SELECT id FROM departments WHERE id = $1", [tenantBDeptId]);
      const roles = await client.query("SELECT id FROM roles WHERE tenant_id = $1", [tenantBId]);
      return { tenant: tenant.rows, user: user.rows, dept: dept.rows, roles: roles.rows };
    });

    expect(seenFromA.tenant).toHaveLength(0);
    expect(seenFromA.user).toHaveLength(0);
    expect(seenFromA.dept).toHaveLength(0);
    expect(seenFromA.roles).toHaveLength(0);

    const tenantAAdminId: string = resA.json().data.admin.id;
    const seenFromB = await withTenantTransaction(tenantBId, async (client) => {
      const user = await client.query("SELECT id FROM users WHERE id = $1", [tenantAAdminId]);
      const tenant = await client.query("SELECT id FROM tenants WHERE id = $1", [tenantAId]);
      return { user: user.rows, tenant: tenant.rows };
    });
    expect(seenFromB.user).toHaveLength(0);
    expect(seenFromB.tenant).toHaveLength(0);

    await server.close();
  });
});
