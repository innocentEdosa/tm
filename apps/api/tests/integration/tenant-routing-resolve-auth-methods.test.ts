import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { resolveTenantBySubdomain } from "../../src/tenant-routing/resolve-tenant";
import { getTestPool } from "../helpers/pg";

describe("resolveTenantBySubdomain — enabledAuthMethods (US3 FR-007)", () => {
  const tenantOnlyEmail = randomUUID();
  const tenantMultiMethod = randomUUID();
  const subdomainOnlyEmail = `methods-email-${randomUUID()}`;
  const subdomainMultiMethod = `methods-multi-${randomUUID()}`;

  afterAll(async () => {
    await closeTestPool();
  });

  it("seeds one tenant with only email_password, another with email_password + microsoft", async () => {
    await withTenantTransaction(tenantOnlyEmail, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Email Only Co', $2, 'Jo', 'jo@emailonly.example')`,
        [tenantOnlyEmail, subdomainOnlyEmail],
      );
      await client.query(`INSERT INTO tenant_auth_methods (tenant_id, method) VALUES ($1, 'email_password')`, [
        tenantOnlyEmail,
      ]);
    });
    await withTenantTransaction(tenantMultiMethod, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Multi Method Co', $2, 'Jo', 'jo@multimethod.example')`,
        [tenantMultiMethod, subdomainMultiMethod],
      );
      await client.query(
        `INSERT INTO tenant_auth_methods (tenant_id, method) VALUES ($1, 'email_password'), ($1, 'microsoft')`,
        [tenantMultiMethod],
      );
    });
  });

  it("returns exactly one tenant's configured method — never leaking into the other's response", async () => {
    const onlyEmailResult = await resolveTenantBySubdomain(getTestPool(), subdomainOnlyEmail);
    expect(onlyEmailResult.enabledAuthMethods).toEqual(["email_password"]);

    const multiResult = await resolveTenantBySubdomain(getTestPool(), subdomainMultiMethod);
    expect(multiResult.enabledAuthMethods?.sort()).toEqual(["email_password", "microsoft"]);
  });
});
