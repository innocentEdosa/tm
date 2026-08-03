import type { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Db } from "./client";

/**
 * Extracts `provisionTenant`'s (apps/api/src/provisioning/provision-tenant.ts) inline
 * pooled-client/`app.tenant_id` pattern into a reusable helper (spec 029 research.md §4). Opens a
 * dedicated connection, `BEGIN`s a transaction, pins `app.tenant_id` to the given `tenantId` so every
 * query issued through the `Db` passed to `fn` runs inside that tenant's RLS scope, then commits on
 * success or rolls back if `fn` throws — always releasing the client back to the pool.
 *
 * For writing into a *specific* tenant's RLS-protected tables from a Super-Admin-triggered flow
 * (e.g. resolving a paid `marketplace_selections` row) — `request.superAdminDb` cannot do this, since
 * it pins `app.tenant_id` to the nil UUID, not a real tenant (platform-auth/super-admin-context.ts).
 */
export async function withTenantConnection<T>(
  pool: Pool,
  tenantId: string,
  fn: (tenantDb: Db) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const tenantDb: Db = drizzle(client);

    const result = await fn(tenantDb);

    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
