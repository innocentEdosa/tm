import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, getTestPool, withTenantTransaction } from "../helpers/pg";
import { resolveTenantBySubdomain } from "../../src/tenant-routing/resolve-tenant";

describe("resolveTenantBySubdomain — suspended/cancelled tenants (US4)", () => {
  const tenantSuspended = randomUUID();
  const tenantCancelled = randomUUID();
  const subdomainSuspended = `susp-${randomUUID()}`;
  const subdomainCancelled = `cancel-${randomUUID()}`;

  afterAll(async () => {
    await closeTestPool();
  });

  it("seeds a suspended and a cancelled tenant", async () => {
    await withTenantTransaction(tenantSuspended, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, status, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Suspended Co', $2, 'suspended', 'Jo', 'jo@susp.example')`,
        [tenantSuspended, subdomainSuspended],
      );
    });
    await withTenantTransaction(tenantCancelled, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, status, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Cancelled Co', $2, 'cancelled', 'Jo', 'jo@cancel.example')`,
        [tenantCancelled, subdomainCancelled],
      );
    });
  });

  it("resolves a suspended tenant with state: suspended and its name — never valid", async () => {
    const result = await resolveTenantBySubdomain(getTestPool(), subdomainSuspended);
    expect(result.state).toBe("suspended");
    expect(result.tenantName).toBe("Suspended Co");
    expect(result.tenantId).toBe(tenantSuspended);
  });

  it("resolves a cancelled tenant with state: cancelled and its name — never valid", async () => {
    const result = await resolveTenantBySubdomain(getTestPool(), subdomainCancelled);
    expect(result.state).toBe("cancelled");
    expect(result.tenantName).toBe("Cancelled Co");
    expect(result.tenantId).toBe(tenantCancelled);
  });
});
