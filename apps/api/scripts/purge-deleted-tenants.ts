import { Pool, type PoolClient } from "pg";

/**
 * Standalone CLI (research.md §5), mirrors `seed-super-admin.ts`'s invocation shape — `tsx`-run, not
 * part of the running server's request path, invoked by an external scheduler (cron/Railway Cron
 * Job). Connects via `APP_DATABASE_URL` (`tm_app`) — every table touched below already grants
 * `tm_app` the `DELETE` it needs (see each feature's own `*_grants.sql`); no elevated role required.
 *
 * Permanently removes a tenant whose deletion grace period has elapsed (spec FR-015b). For each
 * eligible tenant, sets `app.tenant_id` to that tenant's own id before deleting anything — the same
 * bootstrap idiom `provisioning/provision-tenant.ts` uses for inserts, just in reverse for deletes —
 * so every statement below is scoped by the standard `tenant_isolation` RLS policy already on each
 * table, not a bespoke `WHERE tenant_id = $1` trust exercise.
 *
 * Deletion order breaks the two circular FK pairs first (`departments` ↔ `users` via
 * manager/assistant-manager/department_id; `users.invited_by` self-reference), then removes
 * dependents before the tables they reference, and `tenants` itself last. `tenant_action_log` needs
 * no explicit delete — its `tenant_id` FK is `ON DELETE SET NULL` precisely so the audit trail
 * survives (data-model.md `tenant_action_log`).
 */
async function purgeTenant(client: PoolClient, tenantId: string): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    // Break circular references before anything else can be deleted.
    await client.query(
      `UPDATE departments SET manager_id = NULL, assistant_manager_id = NULL, parent_department_id = NULL
       WHERE tenant_id = $1`,
      [tenantId],
    );
    await client.query(
      `UPDATE users SET department_id = NULL, invited_by = NULL WHERE tenant_id = $1`,
      [tenantId],
    );

    // Dependents, in an order that respects every RESTRICT foreign key below them.
    await client.query(`DELETE FROM custom_field_values WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM form_field_order_overrides WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM form_fields WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM training_needs WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM user_roles WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM roles WHERE tenant_id = $1`, [tenantId]); // role_permissions cascades
    await client.query(`DELETE FROM user_sessions WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM password_reset_tokens WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM tenant_auth_methods WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM departments WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM users WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.APP_DATABASE_URL });
  try {
    // No RLS allowance is needed for this initial lookup: `deletion_purge_at` is only ever
    // meaningful platform-wide, and this SELECT runs before `app.tenant_id` is set for any tenant —
    // same "not yet tenant-scoped" posture `provisionTenant` starts from, just at the other end of a
    // tenant's lifecycle. Requires the `super_admin_full_access` policy on `tenants` (migration
    // 0054) via `app.is_super_admin`, since no single `app.tenant_id` covers "every eligible tenant".
    const client = await pool.connect();
    let eligible: { id: string; name: string }[];
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.is_super_admin', 'true', true)");
      const result = await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM tenants WHERE deletion_purge_at IS NOT NULL AND deletion_purge_at <= now()`,
      );
      eligible = result.rows;
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    if (eligible.length === 0) {
      console.log("No tenants past their deletion grace period. Nothing to purge.");
      return;
    }

    for (const tenant of eligible) {
      const purgeClient = await pool.connect();
      try {
        await purgeTenant(purgeClient, tenant.id);
        console.log(`Purged tenant ${tenant.id} (${tenant.name}).`);
      } catch (err) {
        console.error(`Failed to purge tenant ${tenant.id} (${tenant.name}):`, err);
      } finally {
        purgeClient.release();
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
