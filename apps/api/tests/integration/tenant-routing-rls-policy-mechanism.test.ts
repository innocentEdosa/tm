import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";

/**
 * Proves the new `tenant_subdomain_lookup` policy (0018_rls_tenants_subdomain_lookup.sql) grants
 * exactly the intended narrow, read-only, cross-tenant access — no more, no less — against real
 * Postgres, matching rls-cross-tenant.test.ts's precedent for the pre-existing `tenant_isolation`
 * policy.
 */
describe("RLS: tenant_subdomain_lookup policy on tenants", () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const subdomainA = `rls-lookup-a-${randomUUID()}`;
  const subdomainB = `rls-lookup-b-${randomUUID()}`;

  afterAll(async () => {
    await closeTestPool();
  });

  it("seeds two tenants under their own tenant_id (bootstrap idiom)", async () => {
    await withTenantTransaction(tenantA, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Tenant A', $2, 'Jo', 'jo@a.example')`,
        [tenantA, subdomainA],
      );
    });
    await withTenantTransaction(tenantB, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Tenant B', $2, 'Jo', 'jo@b.example')`,
        [tenantB, subdomainB],
      );
    });
  });

  it("without app.subdomain_lookup set, tenant_isolation alone blocks cross-tenant SELECT", async () => {
    const rows = await withTenantTransaction(tenantA, async (client) => {
      const result = await client.query("SELECT id FROM tenants WHERE id = $1", [tenantB]);
      return result.rows;
    });
    expect(rows).toHaveLength(0);
  });

  const NIL_UUID = "00000000-0000-0000-0000-000000000000";

  it("with app.subdomain_lookup set (and app.tenant_id pinned to the nil UUID), either tenant's row is readable by subdomain", async () => {
    // Pinning app.tenant_id to the nil UUID (rather than leaving it genuinely unset) is
    // resolve-tenant.ts's own defensive pattern (see its comment) — a pooled connection previously
    // used by an authenticated tenant request can leave the custom `app.tenant_id` GUC "registered"
    // at '', which throws on tenant_isolation's `::uuid` cast and poisons the whole OR'd query
    // (confirmed empirically: Postgres does not short-circuit around the erroring clause). A valid
    // nil UUID keeps tenant_isolation's clause evaluable (always false here), so only
    // tenant_subdomain_lookup's clause can grant access.
    const rows = await withTenantTransaction(NIL_UUID, async (client) => {
      await client.query("SELECT set_config('app.subdomain_lookup', 'true', true)");
      const resultA = await client.query<{ id: string; status: string }>(
        "SELECT id, status FROM tenants WHERE lower(subdomain) = $1",
        [subdomainA],
      );
      const resultB = await client.query<{ id: string; status: string }>(
        "SELECT id, status FROM tenants WHERE lower(subdomain) = $1",
        [subdomainB],
      );
      return { a: resultA.rows, b: resultB.rows };
    });

    expect(rows.a).toHaveLength(1);
    expect(rows.a[0].id).toBe(tenantA);
    expect(rows.b).toHaveLength(1);
    expect(rows.b[0].id).toBe(tenantB);
  });

  it("app.subdomain_lookup does not grant INSERT/UPDATE — WITH CHECK is unaffected", async () => {
    // tenant_subdomain_lookup is declared FOR SELECT only, so UPDATE remains governed solely by
    // tenant_isolation's USING/WITH CHECK — which fails closed with app.tenant_id pinned to the nil
    // UUID (never equal to any real tenant's id), silently affecting zero rows rather than throwing.
    const rowCount = await withTenantTransaction(NIL_UUID, async (client) => {
      await client.query("SELECT set_config('app.subdomain_lookup', 'true', true)");
      const result = await client.query("UPDATE tenants SET name = 'hijacked' WHERE id = $1", [
        tenantB,
      ]);
      return result.rowCount;
    });
    expect(rowCount).toBe(0);

    const stillIntact = await withTenantTransaction(tenantB, async (client) => {
      const result = await client.query<{ name: string }>("SELECT name FROM tenants WHERE id = $1", [
        tenantB,
      ]);
      return result.rows[0]?.name;
    });
    expect(stillIntact).toBe("Tenant B");
  });
});
