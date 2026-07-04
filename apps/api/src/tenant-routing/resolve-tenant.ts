import type { Pool } from "pg";
import { isReservedSubdomain } from "./reserved-subdomains";

export type TenantRoutingState = "reserved" | "not_found" | "valid" | "suspended" | "cancelled";

export interface TenantRoutingResult {
  state: TenantRoutingState;
  tenantName?: string;
}

/**
 * Resolves a candidate subdomain label to a routing decision (spec 004 FR-004, FR-006-FR-009).
 * Checks the reserved list first — no query is issued for a reserved word (FR-006), regardless of
 * what (if anything) exists in `tenants`. Otherwise looks up `tenants` by (lowercased) subdomain
 * under the narrow `app.subdomain_lookup` RLS allowance (research.md §2,
 * `0018_rls_tenants_subdomain_lookup.sql`) — never `app.tenant_id`, and never returns the tenant's
 * `id` to the caller (research.md §4): only enough to route (a state) and a display name.
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
    const result = await client.query<{ name: string; status: string }>(
      "SELECT name, status FROM tenants WHERE lower(subdomain) = $1",
      [label],
    );
    await client.query("COMMIT");

    const tenant = result.rows[0];
    if (!tenant) {
      return { state: "not_found" };
    }

    switch (tenant.status) {
      case "trial":
      case "active":
        return { state: "valid", tenantName: tenant.name };
      case "suspended":
        return { state: "suspended", tenantName: tenant.name };
      case "cancelled":
        return { state: "cancelled", tenantName: tenant.name };
      default:
        return { state: "not_found" };
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
