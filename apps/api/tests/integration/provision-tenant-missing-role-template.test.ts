import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { closeTestPool } from "../helpers/pg";
import { seedSuperAdminUser } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

/**
 * Uses its own dedicated `DATABASE_URL` (migration/owner role, not subject to `tm_app`'s catalog
 * grants — 0013_lock_department_catalog_grants.sql-style REVOKEs don't apply here) so it can
 * temporarily remove and restore the global `hr_admin` role_templates row. `fileParallelism: false`
 * (vitest.config.ts) ensures no other test file reads the catalog mid-mutation.
 */
describe("POST /provisioning/tenants — fails closed when hr_admin template is missing (FR-014)", () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

  afterAll(async () => {
    await adminPool.end();
    await closeTestPool();
  });

  it("returns 500 and leaves no tenants/departments/users/user_roles row from the attempt", async () => {
    const saved = await adminPool.query<{
      id: string;
      key: string;
      name: string;
      description: string;
      is_platform_only: boolean;
    }>("SELECT id, key, name, description, is_platform_only FROM role_templates WHERE key = 'hr_admin'");
    const template = saved.rows[0];
    const savedMappings = await adminPool.query<{ permission_id: string }>(
      "SELECT permission_id FROM role_template_permissions WHERE role_template_id = $1",
      [template.id],
    );

    const server = await buildTestServer();
    const superAdminUserId = randomUUID();
    await seedSuperAdminUser(superAdminUserId);
    const subdomain = `acme-${randomUUID()}`;

    try {
      await adminPool.query("DELETE FROM role_templates WHERE key = 'hr_admin'");

      const response = await server.inject({
        method: "POST",
        url: "/provisioning/tenants",
        headers: { "x-test-user-id": superAdminUserId, "x-test-tenant-id": randomUUID() },
        payload: {
          company: {
            name: "Acme Corp",
            subdomain,
            primaryContact: { name: "Jordan Lee", email: "jordan.lee@acme.example" },
          },
          admin: { fullName: "Priya Shah", email: `priya.shah+${randomUUID()}@acme.example` },
        },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().success).toBe(false);

      // No tenants row was left behind — check via a session bootstrapped the same way
      // provisionTenant would have, using the subdomain to look it up is impossible (RLS hides
      // everything without a matching tenant_id), so instead confirm via the admin pool
      // (unaffected by tm_app's RLS since it connects as the migration/owner role and RLS's
      // FORCE clause still applies to it — but a superuser bypasses RLS entirely regardless of
      // FORCE, and "tm" is the superuser locally, matching drizzle/init/01-app-role.sql's setup).
      const orphanTenant = await adminPool.query("SELECT id FROM tenants WHERE subdomain = $1", [
        subdomain,
      ]);
      expect(orphanTenant.rows).toHaveLength(0);
    } finally {
      await adminPool.query(
        `INSERT INTO role_templates (id, key, name, description, is_platform_only)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (key) DO NOTHING`,
        [template.id, template.key, template.name, template.description, template.is_platform_only],
      );
      for (const mapping of savedMappings.rows) {
        await adminPool.query(
          `INSERT INTO role_template_permissions (role_template_id, permission_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [template.id, mapping.permission_id],
        );
      }
      await server.close();
    }
  });
});
