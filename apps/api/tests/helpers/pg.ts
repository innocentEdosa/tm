import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Db } from "../../src/db/client";

let pool: Pool | undefined;

/** Connects as `tm_app` (the restricted, RLS-subject role) — the same role the running app uses. */
export function getTestPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.APP_DATABASE_URL });
  }
  return pool;
}

export async function closeTestPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

/**
 * Runs `fn` inside a single transaction with `app.tenant_id` set (via `set_config(..., true)`,
 * the parameterized equivalent of `SET LOCAL`) to `tenantId` — or left unset if `tenantId` is
 * `null`, to exercise the fail-closed case. Commits on success, rolls back on throw.
 */
export async function withTenantTransaction<T>(
  tenantId: string | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getTestPool().connect();
  try {
    await client.query("BEGIN");
    if (tenantId !== null) {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Same as `withTenantTransaction`, but hands `fn` a Drizzle instance — matches `request.tenantDb`. */
export async function withTenantDb<T>(tenantId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  return withTenantTransaction(tenantId, async (client) => fn(drizzle(client)));
}

/** Seeds a bare tenant-owned role via the app role's own tenant transaction (exercises WITH CHECK). */
export async function seedTenantRole(
  tenantId: string,
  name: string,
): Promise<{ id: string }> {
  return withTenantTransaction(tenantId, async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO roles (tenant_id, name) VALUES ($1, $2) RETURNING id`,
      [tenantId, name],
    );
    return result.rows[0];
  });
}
