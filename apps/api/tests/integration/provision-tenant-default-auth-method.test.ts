import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getTestPool, closeTestPool, withTenantTransaction } from "../helpers/pg";
import { provisionTenant } from "../../src/provisioning/provision-tenant";

describe("provisionTenant — default auth method (Tenant Authentication Configuration FR-003)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("has exactly one enabled method (email_password) with no manual step", async () => {
    const subdomain = `auth-default-${randomUUID()}`;
    const result = await provisionTenant(getTestPool(), {
      company: {
        name: "Auth Default Co",
        subdomain,
        primaryContact: { name: "Jo", email: "jo@authdefault.example" },
      },
      admin: { fullName: "Jo Admin", email: `jo+${randomUUID()}@authdefault.example` },
    });

    const methods = await withTenantTransaction(result.tenant.id, async (client) => {
      const rows = await client.query<{ method: string }>(
        "SELECT method FROM tenant_auth_methods WHERE tenant_id = $1",
        [result.tenant.id],
      );
      return rows.rows.map((r) => r.method);
    });

    expect(methods).toEqual(["email_password"]);
  });
});
