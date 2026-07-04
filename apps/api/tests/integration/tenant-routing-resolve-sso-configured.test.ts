import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { resolveTenantBySubdomain } from "../../src/tenant-routing/resolve-tenant";
import { getTestPool } from "../helpers/pg";

describe("Enabling an SSO method requires no OAuth configuration (FR-016)", () => {
  it("enabling Microsoft via settings is reflected in the resolve endpoint's enabledAuthMethods", async () => {
    const tenantId = randomUUID();
    const adminId = randomUUID();
    const subdomain = `sso-configured-${randomUUID()}`;
    await seedUserWithRole(tenantId, adminId, ["manage_authentication_settings"]);
    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'SSO Configured Co', $2, 'Jo', 'jo@sso-configured.example')`,
        [tenantId, subdomain],
      );
      await client.query(`INSERT INTO tenant_auth_methods (tenant_id, method) VALUES ($1, 'email_password')`, [
        tenantId,
      ]);
    });

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PUT",
        url: "/tenant-auth/settings/methods",
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
        payload: { methods: ["email_password", "microsoft"] },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await server.close();
    }

    const resolved = await resolveTenantBySubdomain(getTestPool(), subdomain);
    expect(resolved.enabledAuthMethods?.sort()).toEqual(["email_password", "microsoft"]);

    await closeTestPool();
  });
});
