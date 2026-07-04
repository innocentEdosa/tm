import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, getTestPool, withTenantTransaction } from "../helpers/pg";
import { resolveTenantBySubdomain } from "../../src/tenant-routing/resolve-tenant";
import { RESERVED_SUBDOMAINS } from "../../src/tenant-routing/reserved-subdomains";

describe("resolveTenantBySubdomain — reserved subdomains (US5)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns reserved for every word on the reserved list, with no tenant seeded", async () => {
    for (const word of RESERVED_SUBDOMAINS) {
      const result = await resolveTenantBySubdomain(getTestPool(), word);
      expect(result).toEqual({ state: "reserved" });
    }
  });

  it("returns reserved even when a tenants row exists with that exact subdomain, bypassing app-level validation (FR-006)", async () => {
    const tenantId = randomUUID();
    // Insert directly via SQL fixture, on purpose bypassing provisionTenant's own reserved-word
    // check (FR-016) — proving resolution never trusts "does a row exist" alone. Tolerates a
    // duplicate-subdomain conflict from a prior run of this same test (integration tests here commit
    // real rows, no rollback across runs) — either way, a row with subdomain 'admin' now exists.
    try {
      await withTenantTransaction(tenantId, async (client) => {
        await client.query(
          `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
           VALUES ($1, 'Sneaky Co', 'admin', 'Jo', 'jo@sneaky.example')`,
          [tenantId],
        );
      });
    } catch (err) {
      // Raw pg client error (not Drizzle-wrapped, unlike provision-tenant.ts) — .code is direct.
      if ((err as { code?: string })?.code !== "23505") throw err;
    }

    const result = await resolveTenantBySubdomain(getTestPool(), "admin");
    expect(result).toEqual({ state: "reserved" });
    expect(result.state).not.toBe("valid");
  });
});
