import type { Pool } from "pg";
import { isReservedSubdomain } from "./reserved-subdomains";

export type TenantRoutingState = "reserved" | "not_found" | "valid" | "suspended" | "cancelled";

export interface TenantRoutingResult {
  state: TenantRoutingState;
  /**
   * Present whenever a real tenant row was found (`valid`/`suspended`/`cancelled`). Deliberately
   * NOT part of the public `GET /tenant-routing/resolve` HTTP response (research.md §4 of spec
   * 004) — `tenant-routing-routes.ts` explicitly allow-lists which fields cross that boundary.
   * This field exists for *in-process* callers only (e.g. `tenant-auth/tenant-user-context.ts`,
   * Tenant Authentication Configuration spec), which call this function directly rather than over
   * HTTP and need the real id to scope RLS-protected queries.
   */
  tenantId?: string;
  tenantName?: string;
  /** Only populated when `state === "valid"` (Tenant Authentication Configuration spec). */
  enabledAuthMethods?: string[];
}

/**
 * Resolves a candidate subdomain label to a routing decision (spec 004 FR-004, FR-006-FR-009).
 * Checks the reserved list first — no query is issued for a reserved word (FR-006), regardless of
 * what (if anything) exists in `tenants`. Otherwise looks up `tenants` by (lowercased) subdomain
 * under the narrow `app.subdomain_lookup` RLS allowance (research.md §2,
 * `0018_rls_tenants_subdomain_lookup.sql`) — never `app.tenant_id`.
 */
export async function resolveTenantBySubdomain(
  pool: Pool,
  subdomain: string,
): Promise<TenantRoutingResult> {
  const label = subdomain.toLowerCase();

  if (isReservedSubdomain(label)) {
    return { state: "reserved" };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Defensively pin app.tenant_id to the nil UUID rather than leaving it unset. Connections are
    // drawn from the same pool tenant-context.ts uses, so a physical backend previously handed to an
    // authenticated tenant request may still have the custom `app.tenant_id` GUC "registered" from
    // that now-ended SET LOCAL — once registered, current_setting(..., true) returns '' (not NULL)
    // for the rest of that backend's life, and casting '' to uuid in tenant_isolation's own USING
    // clause throws, which poisons this entire query since Postgres evaluates both OR'd permissive
    // policies' quals (confirmed empirically — not short-circuited by policy order). A syntactically
    // valid nil UUID makes tenant_isolation's clause evaluate cleanly to `false` for every real
    // tenant, so only tenant_subdomain_lookup's clause (set next) can grant access here.
    await client.query("SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000000', true)");
    await client.query("SELECT set_config('app.subdomain_lookup', 'true', true)");
    const result = await client.query<{
      id: string;
      name: string;
      status: string;
      archived_at: Date | null;
      deletion_requested_at: Date | null;
    }>(
      "SELECT id, name, status, archived_at, deletion_requested_at FROM tenants WHERE lower(subdomain) = $1",
      [label],
    );

    const tenant = result.rows[0];
    if (!tenant) {
      await client.query("COMMIT");
      return { state: "not_found" };
    }

    // Tenant Management spec, User Stories 3 & 5 — archived and pending-deletion are orthogonal to
    // `status` (data-model.md `tenants`), so they aren't reachable through the switch below at all;
    // treated as `suspended` here rather than adding new routing states, since "recognized tenant,
    // not currently usable" is exactly what a suspended tenant already communicates to
    // `apps/web/middleware.ts`'s consumers of this result (FR-007, FR-015).
    if (tenant.archived_at || tenant.deletion_requested_at) {
      await client.query("COMMIT");
      return { state: "suspended", tenantId: tenant.id, tenantName: tenant.name };
    }

    switch (tenant.status) {
      case "trial":
      case "active": {
        // tenant_auth_methods has the *standard* tenant_isolation policy (no subdomain_lookup
        // allowance) — re-pin app.tenant_id to the now-known real tenant id (still
        // transaction-local) so this query is normally RLS-scoped, rather than blocked like the
        // nil-UUID pin above would leave it.
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.id]);
        const methodsResult = await client.query<{ method: string }>(
          "SELECT method FROM tenant_auth_methods WHERE tenant_id = $1",
          [tenant.id],
        );
        await client.query("COMMIT");
        return {
          state: "valid",
          tenantId: tenant.id,
          tenantName: tenant.name,
          enabledAuthMethods: methodsResult.rows.map((r) => r.method),
        };
      }
      case "suspended":
        await client.query("COMMIT");
        return { state: "suspended", tenantId: tenant.id, tenantName: tenant.name };
      case "cancelled":
        await client.query("COMMIT");
        return { state: "cancelled", tenantId: tenant.id, tenantName: tenant.name };
      default:
        await client.query("COMMIT");
        return { state: "not_found" };
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
