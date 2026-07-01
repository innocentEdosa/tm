import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool } from "../helpers/pg";

/**
 * FR-011/SC-005: a brand-new permission must never be auto-granted to any existing role — not the
 * default templates, not the platform Super Admin role, not any tenant-customized role. Only a
 * migration role can even insert into `permissions` (0001_lock_catalog_grants.sql), so this test
 * inserts via `DATABASE_URL` (the migration/owner role) — exactly how a real new permission would
 * ship.
 */
describe("new permissions are never auto-granted to existing roles", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("a newly-inserted permission has zero role_template_permissions and zero role_permissions rows", async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const newKey = `test_new_permission_${randomUUID().replace(/-/g, "")}`;
    try {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO permissions (key, display_name, description, category)
         VALUES ($1, 'Test New Permission', 'Inserted after initial seed for FR-011 coverage', 'test')
         RETURNING id`,
        [newKey],
      );
      const newPermissionId = inserted.rows[0].id;

      const templateGrants = await client.query(
        "SELECT 1 FROM role_template_permissions WHERE permission_id = $1",
        [newPermissionId],
      );
      expect(templateGrants.rows).toHaveLength(0);

      // Covers every existing role — default templates, the platform Super Admin role (both
      // seeded before this insert), and any tenant roles created by earlier test runs.
      const roleGrants = await client.query(
        "SELECT 1 FROM role_permissions WHERE permission_id = $1",
        [newPermissionId],
      );
      expect(roleGrants.rows).toHaveLength(0);
    } finally {
      await client.query("DELETE FROM permissions WHERE key = $1", [newKey]);
      await client.end();
    }
  });
});
