import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { resolveTenantBySubdomain } from "../tenant-routing/resolve-tenant";
import { parseCookie, TENANT_USER_COOKIE_NAME } from "./cookies";
import { hashSessionToken } from "../platform-auth/session";

/**
 * Mirrors `apps/api/src/plugins/tenant-context.ts`'s `onRequest`-hook idiom, but only to *decorate
 * `request.user`* — it does not expose its own lasting DB handle. Once `request.user` is set here,
 * the existing, unchanged `tenant-context.ts` plugin (registered immediately after this one, see
 * `server.ts`) opens its own dedicated transaction and provides `request.tenantDb` exactly as it
 * already does for the dev-only header stub. This plugin is the "future auth mechanism" that
 * `tenant-context.ts`'s own doc comment has assumed since Spec 1.
 *
 * Reads `subdomain` from the query string (never the body — Fastify's `onRequest` phase runs before
 * body parsing, research.md §4 addendum), independently resolves it via Spec 4's
 * `resolveTenantBySubdomain` (never trusting it directly as a tenant_id), and — only if a real
 * session cookie matches a live `user_sessions` row under that resolved tenant — sets
 * `request.user`/`request.mustChangePassword`.
 *
 * No narrow RLS allowance is needed for the `user_sessions` lookup: `app.tenant_id` is set to the
 * already-resolved value *before* the query runs, in a short-lived, self-contained transaction (not
 * held open for the rest of the request) — the standard `tenant_isolation` policy alone makes a
 * session from a different tenant invisible (research.md §3), which is also how spec FR-012
 * (cross-tenant session rejection) is satisfied, with no bespoke comparison logic.
 */
const tenantUserContextPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", async (request) => {
    const subdomain = (request.query as { subdomain?: string } | undefined)?.subdomain;
    if (!subdomain) {
      return;
    }

    const resolved = await resolveTenantBySubdomain(fastify.pg.pool, subdomain);
    if (resolved.state !== "valid" || !resolved.tenantId) {
      return;
    }

    const token = parseCookie(request.headers.cookie, TENANT_USER_COOKIE_NAME);
    if (!token) {
      return;
    }

    const tokenHash = hashSessionToken(token);
    const client = await fastify.pg.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [resolved.tenantId]);

      const sessionResult = await client.query<{ user_id: string }>(
        `SELECT user_id FROM user_sessions
         WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
        [tokenHash],
      );
      const session = sessionResult.rows[0];
      if (!session) {
        return;
      }

      // Tenant Management spec (015), User Stories 3 & 5 — an already-established session must stop
      // working the moment its own tenant is archived or put into pending-deletion, not just be
      // blocked from a *new* login, exactly mirroring the users.archived_at check just below for the
      // per-user case (research.md §3 there).
      const tenantResult = await client.query<{
        archived_at: Date | null;
        deletion_requested_at: Date | null;
      }>("SELECT archived_at, deletion_requested_at FROM tenants WHERE id = $1", [resolved.tenantId]);
      if (tenantResult.rows[0]?.archived_at || tenantResult.rows[0]?.deletion_requested_at) {
        return;
      }

      const userResult = await client.query<{ must_change_password: boolean; archived_at: Date | null }>(
        "SELECT must_change_password, archived_at FROM users WHERE id = $1",
        [session.user_id],
      );

      // Spec 013 (archive capability) — an already-established session must stop working the moment
      // the account is archived, not just be blocked from a *new* login; leaving `request.user`
      // unset here makes every `requireTenantUserSession()`-guarded route treat them as logged out.
      if (userResult.rows[0]?.archived_at) {
        return;
      }

      request.user = { id: session.user_id, tenantId: resolved.tenantId };
      request.mustChangePassword = userResult.rows[0]?.must_change_password ?? false;
    } finally {
      await client.query("COMMIT");
      client.release();
    }
  });
};

export default fp(tenantUserContextPlugin, { name: "tenant-user-context" });
