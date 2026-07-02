import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { seedSuperAdminUser } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

function validBody(subdomain: string) {
  return {
    company: {
      name: "Acme Corp",
      subdomain,
      primaryContact: { name: "Jordan Lee", email: "jordan.lee@acme.example" },
    },
    admin: { fullName: "Priya Shah", email: `priya.shah+${randomUUID()}@acme.example` },
  };
}

describe("POST /provisioning/tenants — admin creation & role assignment (US2)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("creates the admin user and assigns exactly the HR Admin role, matching its permission set", async () => {
    const server = await buildTestServer();
    const superAdminUserId = randomUUID();
    await seedSuperAdminUser(superAdminUserId);
    const subdomain = `acme-${randomUUID()}`;

    const response = await server.inject({
      method: "POST",
      url: "/provisioning/tenants",
      headers: { "x-test-user-id": superAdminUserId, "x-test-tenant-id": randomUUID() },
      payload: validBody(subdomain),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.admin.fullName).toBe("Priya Shah");
    expect(body.data.admin.roleAssigned).toBe("HR/L&D Admin");

    // Effective permissions match exactly the hr_admin template (SC-006): verify via the tenant's
    // own RLS-scoped session that the admin's role grants exactly the expected permission keys.
    const tenantId: string = body.data.tenant.id;
    const permissionKeys = await withTenantTransaction(tenantId, async (client) => {
      const result = await client.query<{ key: string }>(
        `SELECT p.key FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE ur.user_id = $1
         ORDER BY p.key`,
        [body.data.admin.id],
      );
      return result.rows.map((r) => r.key);
    });
    expect(permissionKeys).toEqual(
      ["approve_enrollment", "edit_content_library", "manage_roles", "view_department_analytics"].sort(),
    );

    await server.close();
  });
});
