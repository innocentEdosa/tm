import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const tenantClients = new WeakMap<FastifyRequest, PoolClient>();

/**
 * Opens one transaction per request that has an authenticated session, sets
 * `app.tenant_id` via `set_config(..., true)` (transaction-local, equivalent to `SET LOCAL`, but
 * safely parameterized rather than string-interpolated), and decorates `request.tenantDb` with a
 * Drizzle instance bound to that same client — so every query issued through `request.tenantDb`
 * runs inside the tenant-scoped transaction and is subject to RLS.
 *
 * The tenant id comes ONLY from `request.user.tenantId`, decorated by the (future) auth mechanism
 * from the server-verified session — never from a client-supplied header/body/query value
 * (constitution Principle I; research.md §2-3).
 *
 * Uses a dedicated pooled client per request (not the shared pool) because `SET LOCAL` must run
 * inside an explicit transaction on one physical connection: a plain `SET` on a pooled connection
 * would leak into whichever request the pool hands that connection to next.
 */
const tenantContextPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", async (request) => {
    if (!request.user) {
      return;
    }

    const client = await fastify.pg.pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.user.tenantId]);

    tenantClients.set(request, client);
    request.tenantDb = drizzle(client);
  });

  fastify.addHook("onResponse", async (request) => {
    const client = tenantClients.get(request);
    if (!client) return;
    tenantClients.delete(request);
    try {
      await client.query("COMMIT");
    } finally {
      client.release();
    }
  });

  fastify.addHook("onError", async (request) => {
    const client = tenantClients.get(request);
    if (!client) return;
    tenantClients.delete(request);
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
};

export default fp(tenantContextPlugin, { name: "tenant-context" });
