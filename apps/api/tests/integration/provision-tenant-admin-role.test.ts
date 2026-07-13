import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { seedSuperAdminSession } from "../helpers/fixtures";
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
    const { cookieHeader } = await seedSuperAdminSession();
    const subdomain = `acme-${randomUUID()}`;

    const response = await server.inject({
      method: "POST",
      url: "/provisioning/tenants",
      headers: { cookie: cookieHeader },
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
      [
        "approve_enrollment",
        "edit_content_library",
        "manage_roles",
        "view_department_analytics",
        // Tenant Authentication Configuration spec (0022_seed_tenant_auth_permissions.sql):
        "manage_authentication_settings",
        "manage_team_members",
        // Department Management spec (0025_seed_department_permissions.sql):
        "department.view",
        "department.manage",
        // Extensible Custom Fields Framework spec (0031_seed_forms_permissions.sql):
        "forms.manage.tenant",
        // Granular Permissions addendum (0038_seed_granular_crud_permissions.sql):
        "department.create",
        "department.edit",
        "department.delete",
        "roles.read",
        "roles.create",
        "roles.edit",
        "roles.delete",
        "forms.tenant.read",
        "forms.tenant.create",
        "forms.tenant.edit",
        "team.create",
        // Team Member Directory spec (0040_seed_team_view_permissions.sql):
        "team.view.all",
        // Add/Edit Team Member spec (0042_seed_team_edit_permission.sql):
        "team.edit",
        // Training Needs Analysis spec (0050_seed_tna_permissions.sql):
        "tna.view.all",
        "tna.manage.all",
      ].sort(),
    );

    await server.close();
  });
});
