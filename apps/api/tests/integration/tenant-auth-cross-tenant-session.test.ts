import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { hashPassword } from "../../src/platform-auth/password";

describe("Cross-tenant session rejection (FR-012, US2 AS4)", () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const subdomainA = `cross-a-${randomUUID()}`;
  const subdomainB = `cross-b-${randomUUID()}`;
  const email = `jo+${randomUUID()}@cross-tenant.example`;
  const password = "correct horse battery staple";

  afterAll(async () => {
    await closeTestPool();
  });

  it("seeds two tenants, each with a real user", async () => {
    const passwordHash = await hashPassword(password);
    await withTenantTransaction(tenantA, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Cross Tenant A', $2, 'Jo', 'jo@cross-a.example')`,
        [tenantA, subdomainA],
      );
      await client.query(
        `INSERT INTO users (tenant_id, full_name, email, password_hash) VALUES ($1, 'Jo A', $2, $3)`,
        [tenantA, email, passwordHash],
      );
    });
    await withTenantTransaction(tenantB, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Cross Tenant B', $2, 'Jo', 'jo@cross-b.example')`,
        [tenantB, subdomainB],
      );
    });
  });

  it("a session obtained at tenant A's subdomain is rejected when presented at tenant B's", async () => {
    const server = await buildTestServer();
    try {
      const loginResponse = await server.inject({
        method: "POST",
        url: `/tenant-auth/login?subdomain=${subdomainA}`,
        payload: { email, password },
      });
      expect(loginResponse.statusCode).toBe(200);
      const cookie = (loginResponse.headers["set-cookie"] as string).split(";")[0];

      const meAtWrongTenant = await server.inject({
        method: "GET",
        url: `/tenant-auth/me?subdomain=${subdomainB}`,
        headers: { cookie },
      });
      expect(meAtWrongTenant.statusCode).toBe(401);

      const meAtCorrectTenant = await server.inject({
        method: "GET",
        url: `/tenant-auth/me?subdomain=${subdomainA}`,
        headers: { cookie },
      });
      expect(meAtCorrectTenant.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });
});
