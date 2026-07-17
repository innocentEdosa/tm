import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { getTestPool, closeTestPool } from "../helpers/pg";

/**
 * Training Request Rename (spec 020) — verifies migration 0064's grant-preservation guarantee
 * (spec FR-005/SC-002, research.md §5). By the time this suite runs, migration 0064 has already
 * been applied once to this shared test database, so there is no "before" state left to replay
 * directly — instead this asserts (a) the migration's declared end state, and (b) the underlying
 * mechanism (renaming `permissions.key` in place never touches `role_permissions`) generically,
 * inside a transaction that is always rolled back so it leaves no permanent trace on the shared
 * `permissions` table other integration tests depend on.
 */
describe("Training Request permission rename (spec 020, migration 0064)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("left exactly the five training_request.* keys in place, with none of the old tna.* keys remaining", async () => {
    const client = await getTestPool().connect();
    try {
      const { rows } = await client.query(
        `SELECT key FROM permissions WHERE key = ANY($1::text[])`,
        [
          [
            "tna.view.all",
            "tna.view.department",
            "tna.manage.all",
            "tna.manage.department",
            "tna.approve",
            "training_request.view.all",
            "training_request.view.department",
            "training_request.manage.all",
            "training_request.manage.department",
            "training_request.approve",
          ],
        ],
      );
      expect(rows.map((r) => r.key as string).sort()).toEqual(
        [
          "training_request.view.all",
          "training_request.view.department",
          "training_request.manage.all",
          "training_request.manage.department",
          "training_request.approve",
        ].sort(),
      );
    } finally {
      client.release();
    }
  });

  /**
   * `tm_app` has UPDATE revoked on `permissions` by design (0001_lock_catalog_grants.sql) — only
   * the migration-runner role can relabel a permission key, the same restriction that makes this
   * table safe from accidental app-layer mutation. This test therefore connects directly via
   * `DATABASE_URL` (the migration/owner role, same pattern as `seedSuperAdminSession` in
   * `fixtures.ts`), which also bypasses RLS, so no `app.tenant_id` needs to be set.
   */
  it("preserves every existing role_permissions grant across a permissions.key rename — the exact mechanism migration 0064 relies on", async () => {
    const tenantId = randomUUID();
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, $2, $3, 'Test Contact', $4)`,
        [tenantId, "Migration Safety Tenant", `test-${tenantId}`, `contact-${tenantId}@example.com`],
      );

      const { rows: permRows } = await client.query(
        `SELECT id FROM permissions WHERE key = 'training_request.view.all'`,
      );
      expect(permRows.length).toBe(1);
      const permissionId: string = permRows[0].id;

      const { rows: roleRows } = await client.query(
        `INSERT INTO roles (tenant_id, name) VALUES ($1, $2) RETURNING id`,
        [tenantId, `Migration Safety Role ${randomUUID()}`],
      );
      const roleId: string = roleRows[0].id;
      await client.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`, [
        roleId,
        permissionId,
      ]);

      const countFor = async () => {
        const { rows } = await client.query(
          `SELECT count(*)::int AS n FROM role_permissions WHERE role_id = $1`,
          [roleId],
        );
        return rows[0].n as number;
      };

      const beforeCount = await countFor();

      const tempKey = `training_request.view.all__migration_test_${randomUUID()}`;
      await client.query(`UPDATE permissions SET key = $1 WHERE id = $2`, [tempKey, permissionId]);

      const afterCount = await countFor();
      const { rows: afterPermRows } = await client.query(
        `SELECT id, key FROM permissions WHERE id = $1`,
        [permissionId],
      );
      const { rows: resolvedRows } = await client.query(
        `SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1`,
        [roleId],
      );

      // Same row, same id, same grant count — only the label changed underneath it.
      expect(afterCount).toBe(beforeCount);
      expect(afterPermRows[0].id).toBe(permissionId);
      expect(afterPermRows[0].key).toBe(tempKey);
      expect(resolvedRows.map((r) => r.key)).toEqual([tempKey]);
    } finally {
      // Always rolled back, never committed — the temporary key rename above must not survive
      // this test, since `permissions` is a shared, un-migrated-per-test table.
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      await pool.end();
    }
  });
});
