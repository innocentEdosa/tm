import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { resolveTenantBySubdomain } from "../../src/tenant-routing/resolve-tenant";
import { getTestPool } from "../helpers/pg";

describe("resolveTenantBySubdomain — valid tenant subdomains (US1)", () => {
  const tenantTrial = randomUUID();
  const tenantActive = randomUUID();
  const subdomainTrial = `valid-trial-${randomUUID()}`;
  const subdomainActive = `valid-active-${randomUUID()}`;

  afterAll(async () => {
    await closeTestPool();
  });

  it("seeds one trial and one active tenant", async () => {
    await withTenantTransaction(tenantTrial, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Trial Co', $2, 'Jo', 'jo@trial.example')`,
        [tenantTrial, subdomainTrial],
      );
    });
    await withTenantTransaction(tenantActive, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, status, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Active Co', $2, 'active', 'Jo', 'jo@active.example')`,
        [tenantActive, subdomainActive],
      );
    });
  });

  it("resolves a trial-status tenant as valid, with its own name", async () => {
    const result = await resolveTenantBySubdomain(getTestPool(), subdomainTrial);
    expect(result.state).toBe("valid");
    expect(result.tenantName).toBe("Trial Co");
    expect(result.tenantId).toBe(tenantTrial);
    expect(result.enabledAuthMethods).toEqual([]);
  });

  it("resolves an active-status tenant as valid, with its own name", async () => {
    const result = await resolveTenantBySubdomain(getTestPool(), subdomainActive);
    expect(result.state).toBe("valid");
    expect(result.tenantName).toBe("Active Co");
    expect(result.tenantId).toBe(tenantActive);
  });

  it("never returns one tenant's name when resolving the other's subdomain (spec SC-001)", async () => {
    const trialResult = await resolveTenantBySubdomain(getTestPool(), subdomainTrial);
    const activeResult = await resolveTenantBySubdomain(getTestPool(), subdomainActive);
    expect(trialResult.tenantName).not.toBe(activeResult.tenantName);
    expect(trialResult.tenantId).not.toBe(activeResult.tenantId);
  });

  // Note: resolveTenantBySubdomain() itself now DOES return tenantId, for in-process callers only
  // (e.g. tenant-auth/tenant-user-context.ts, Tenant Authentication Configuration spec). The "never
  // leaks tenantId" guarantee moved to the HTTP boundary — see
  // tenant-routing-http-allowlist.test.ts, which proves GET /tenant-routing/resolve's JSON response
  // never includes it.
});
