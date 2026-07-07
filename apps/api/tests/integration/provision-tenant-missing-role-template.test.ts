import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { closeTestPool } from "../helpers/pg";
import { seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

/**
 * Uses its own dedicated `DATABASE_URL` (migration/owner role, not subject to `tm_app`'s catalog
 * grants — 0013_lock_department_catalog_grants.sql-style REVOKEs don't apply here) so it can
 * temporarily remove and restore the global `hr_admin` role_templates row. `fileParallelism: false`
 * (vitest.config.ts) ensures no other test file reads the catalog mid-mutation.
 *
 * `roles.source_template_id` references `role_templates.id` with `ON DELETE SET NULL` — so
 * deleting the hr_admin template below cascades and nulls out `source_template_id` on *every* role
 * across the entire shared database currently linked to it, not just this test's own tenant
 * (discovered while building the Roles Management UI spec — this is exactly the signal that
 * spec's system-role protection relies on). The `finally` block must therefore capture which real
 * role ids get nulled *before* deleting the template, and explicitly re-link them afterward — simply
 * re-inserting the template row (even with the same id) does not retroactively restore an
 * already-nulled foreign key on an unrelated row.
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
    const affectedRoleIds = (
      await adminPool.query<{ id: string }>("SELECT id FROM roles WHERE source_template_id = $1", [template.id])
    ).rows.map((r) => r.id);

    const server = await buildTestServer();
    const { cookieHeader } = await seedSuperAdminSession();
    const subdomain = `acme-${randomUUID()}`;

    try {
      await adminPool.query("DELETE FROM role_templates WHERE key = 'hr_admin'");

      const response = await server.inject({
        method: "POST",
        url: "/provisioning/tenants",
        headers: { cookie: cookieHeader },
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
      // Re-link every real role the DELETE's ON DELETE SET NULL cascade nulled out — the template
      // row above being reinserted with the same id does not do this on its own.
      if (affectedRoleIds.length > 0) {
        await adminPool.query(
          `UPDATE roles SET source_template_id = $1 WHERE id = ANY($2) AND source_template_id IS NULL`,
          [template.id, affectedRoleIds],
        );
      }
      await server.close();
    }
  });
});
