import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getTestPool, closeTestPool, withTenantTransaction } from "../helpers/pg";
import { provisionTenant, ReservedSubdomainError } from "../../src/provisioning/provision-tenant";

function validInput(subdomain: string) {
  return {
    company: {
      name: "Bad Co",
      subdomain,
      primaryContact: { name: "Jo", email: "jo@bad.example" },
    },
    admin: { fullName: "Jo Admin", email: `jo+${randomUUID()}@bad.example` },
  };
}

describe("provisionTenant — reserved subdomains (Spec 2 FR-016)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  // Uses "www" rather than "admin" — tenant-routing-reserved-rejected.test.ts deliberately seeds a
  // real row with subdomain 'admin' to prove a different guarantee (FR-006), so this test picks a
  // reserved word it doesn't share, keeping the "creates no row" assertion below meaningful.
  it("rejects a reserved word as a submitted subdomain and creates no tenant record", async () => {
    await expect(provisionTenant(getTestPool(), validInput("www"))).rejects.toBeInstanceOf(
      ReservedSubdomainError,
    );

    // Confirm no tenant record exists for the reserved word — read via an app-role connection with
    // the narrow subdomain-lookup allowance, same mechanism the routing layer itself uses.
    const rows = await withTenantTransaction("00000000-0000-0000-0000-000000000000", async (client) => {
      await client.query("SELECT set_config('app.subdomain_lookup', 'true', true)");
      const result = await client.query("SELECT id FROM tenants WHERE lower(subdomain) = 'www'");
      return result.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it("rejects every word on the reserved list", async () => {
    const { RESERVED_SUBDOMAINS } = await import("../../src/tenant-routing/reserved-subdomains");
    for (const word of RESERVED_SUBDOMAINS) {
      await expect(provisionTenant(getTestPool(), validInput(word))).rejects.toBeInstanceOf(
        ReservedSubdomainError,
      );
    }
  });
});
