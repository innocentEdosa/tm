import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, getTestPool, withTenantTransaction } from "../helpers/pg";
import { resolveTenantBySubdomain } from "../../src/tenant-routing/resolve-tenant";

describe("resolveTenantBySubdomain — case-insensitivity (spec Edge Cases)", () => {
  const tenantId = randomUUID();
  const subdomain = `casetest${randomUUID().replace(/-/g, "")}`;

  afterAll(async () => {
    await closeTestPool();
  });

  it("seeds a tenant with a lowercase subdomain", async () => {
    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Case Co', $2, 'Jo', 'jo@case.example')`,
        [tenantId, subdomain],
      );
    });
  });

  it("resolves identically regardless of the requested label's casing", async () => {
    const lower = await resolveTenantBySubdomain(getTestPool(), subdomain);
    const upper = await resolveTenantBySubdomain(getTestPool(), subdomain.toUpperCase());
    const mixed = await resolveTenantBySubdomain(
      getTestPool(),
      subdomain.charAt(0).toUpperCase() + subdomain.slice(1),
    );

    expect(lower).toEqual({ state: "valid", tenantName: "Case Co" });
    expect(upper).toEqual(lower);
    expect(mixed).toEqual(lower);
  });

  it("treats reserved words case-insensitively too", async () => {
    const result = await resolveTenantBySubdomain(getTestPool(), "ADMIN");
    expect(result).toEqual({ state: "reserved" });
  });
});
