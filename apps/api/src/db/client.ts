import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { FastifyInstance } from "fastify";

/** Shared by both the pool-bound `fastify.db` and the per-request, client-bound `request.tenantDb`. */
export type Db = NodePgDatabase<Record<string, never>>;

/**
 * Non-transactional Drizzle instance bound to the whole pool — for platform-level queries
 * (e.g. the Super Admin catalog routes) that intentionally run outside any tenant's
 * `SET LOCAL app.tenant_id` transaction (research.md §3, contracts/super-admin-catalog-api.md).
 * Tenant-scoped routes must use `request.tenantDb` (apps/api/src/plugins/tenant-context.ts)
 * instead, never this.
 */
export function createDb(fastify: FastifyInstance): Db {
  return drizzle(fastify.pg.pool);
}
