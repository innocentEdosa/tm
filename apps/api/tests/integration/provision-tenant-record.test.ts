import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getTestPool, closeTestPool, withTenantTransaction } from "../helpers/pg";
import { provisionTenant, SubdomainTakenError } from "../../src/provisioning/provision-tenant";

function validInput(subdomain: string) {
  return {
    company: {
      name: "Acme Corp",
      subdomain,
      industry: "Manufacturing",
      primaryContact: { name: "Jordan Lee", email: "jordan.lee@acme.example" },
    },
    admin: { fullName: "Priya Shah", email: `priya.shah+${randomUUID()}@acme.example` },
  };
}

describe("provisionTenant — tenant record creation (US1)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("creates a tenants row with status 'trial' and the submitted fields", async () => {
    const subdomain = `acme-${randomUUID()}`;
    const result = await provisionTenant(getTestPool(), validInput(subdomain));

    expect(result.tenant.name).toBe("Acme Corp");
    expect(result.tenant.subdomain).toBe(subdomain);
    expect(result.tenant.status).toBe("trial");
    expect(result.tenant.id).toBeTruthy();
  });

  it("rejects a duplicate subdomain and leaves no second row", async () => {
    const subdomain = `acme-${randomUUID()}`;
    const first = await provisionTenant(getTestPool(), validInput(subdomain));

    await expect(provisionTenant(getTestPool(), validInput(subdomain))).rejects.toBeInstanceOf(
      SubdomainTakenError,
    );

    // Confirm no second tenants row exists for this subdomain — read back through the first
    // tenant's own RLS-scoped session (a raw tm_app connection with no app.tenant_id set would see
    // zero rows regardless, per RLS fail-closed behavior).
    const rows = await withTenantTransaction(first.tenant.id, async (client) => {
      const result = await client.query<{ id: string }>(
        "SELECT id FROM tenants WHERE subdomain = $1",
        [subdomain],
      );
      return result.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.tenant.id);
  });
});
