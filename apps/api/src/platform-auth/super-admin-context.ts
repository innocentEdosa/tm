import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, gt, isNull } from "drizzle-orm";
import { superAdmins, superAdminSessions } from "../db/schema/super-admins";
import { parseCookie, SUPER_ADMIN_COOKIE_NAME } from "./cookies";
import { hashSessionToken } from "./session";

const superAdminClients = new WeakMap<FastifyRequest, PoolClient>();

/**
 * Mirrors `apps/api/src/plugins/tenant-context.ts`'s idiom exactly (research.md §6): on every
 * request that presents a valid, non-expired, non-revoked Super Admin session cookie, opens a
 * dedicated transaction, sets `app.is_super_admin` via `set_config(..., true)` (transaction-local),
 * and decorates `request.superAdminDb` with a Drizzle instance bound to that same client — so any
 * query issued through it is subject to the Super Admin RLS allowance clause future tenant-scoped
 * tables adopt (spec FR-012, FR-013).
 *
 * The session comes ONLY from a validated `super_admin_sessions` lookup — never from any
 * client-supplied header, cookie value, or request field beyond the opaque token itself, which is
 * meaningless without a matching row (constitution Principle I; spec FR-012, Acceptance Scenario 3).
 */
const superAdminContextPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", async (request) => {
    const token = parseCookie(request.headers.cookie, SUPER_ADMIN_COOKIE_NAME);
    if (!token) {
      return;
    }

    const tokenHash = hashSessionToken(token);
    const [session] = await fastify.db
      .select({
        superAdminId: superAdminSessions.superAdminId,
        email: superAdmins.email,
        name: superAdmins.name,
      })
      .from(superAdminSessions)
      .innerJoin(superAdmins, eq(superAdmins.id, superAdminSessions.superAdminId))
      .where(
        and(
          eq(superAdminSessions.tokenHash, tokenHash),
          isNull(superAdminSessions.revokedAt),
          gt(superAdminSessions.expiresAt, new Date()),
        ),
      );

    if (!session) {
      return;
    }

    request.superAdmin = { id: session.superAdminId, email: session.email, name: session.name };

    const client = await fastify.pg.pool.connect();
    await client.query("BEGIN");
    // Tenant Management spec, research.md §8 — defensive nil-UUID pin, same fix already applied in
    // tenant-routing/resolve-tenant.ts for the same underlying gotcha: this pooled connection may
    // have previously served a tenant-scoped request whose now-ended `SET LOCAL app.tenant_id` left
    // the GUC "registered" on this physical backend, so `current_setting('app.tenant_id', true)`
    // returns `''` (not NULL) for the rest of the backend's life. `tenants`/`user_sessions` now carry
    // a second, OR'd permissive policy (`super_admin_full_access`) alongside their existing
    // `tenant_isolation` policy, and Postgres evaluates every OR'd policy's qual regardless of which
    // one would actually grant access — casting `''` to `uuid` in `tenant_isolation`'s clause throws
    // and poisons the whole query. Pinning to the nil UUID makes that clause evaluate to `false`
    // instead, without needing every future `super_admin_full_access` table to rediscover this.
    await client.query(
      "SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000000', true)",
    );
    await client.query("SELECT set_config('app.is_super_admin', 'true', true)");

    superAdminClients.set(request, client);
    request.superAdminDb = drizzle(client);
  });

  fastify.addHook("onResponse", async (request) => {
    const client = superAdminClients.get(request);
    if (!client) return;
    superAdminClients.delete(request);
    try {
      await client.query("COMMIT");
    } finally {
      client.release();
    }
  });

  fastify.addHook("onError", async (request) => {
    const client = superAdminClients.get(request);
    if (!client) return;
    superAdminClients.delete(request);
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
};

export default fp(superAdminContextPlugin, { name: "super-admin-context" });
