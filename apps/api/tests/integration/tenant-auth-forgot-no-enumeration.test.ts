import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";

describe("POST /tenant-auth/forgot-password — no enumeration (FR-015, US4 AS3)", () => {
  const tenantId = randomUUID();
  const subdomain = `forgot-noenum-${randomUUID()}`;
  const realEmail = `jo+${randomUUID()}@forgot-noenum.example`;

  afterAll(async () => {
    await closeTestPool();
  });

  it("seeds a tenant and a real user", async () => {
    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Forgot No Enum Co', $2, 'Jo', 'jo@forgot-noenum.example')`,
        [tenantId, subdomain],
      );
      await client.query(`INSERT INTO users (tenant_id, full_name, email) VALUES ($1, 'Jo Admin', $2)`, [
        tenantId,
        realEmail,
      ]);
    });
  });

  it("returns an identical response for a real account vs. a nonexistent email at the same tenant", async () => {
    const server = await buildTestServer();
    try {
      const realResponse = await server.inject({
        method: "POST",
        url: `/tenant-auth/forgot-password?subdomain=${subdomain}`,
        payload: { email: realEmail },
      });
      const fakeResponse = await server.inject({
        method: "POST",
        url: `/tenant-auth/forgot-password?subdomain=${subdomain}`,
        payload: { email: `doesnotexist-${randomUUID()}@forgot-noenum.example` },
      });

      expect(realResponse.statusCode).toBe(200);
      expect(fakeResponse.statusCode).toBe(200);
      expect(realResponse.body).toBe(fakeResponse.body);
    } finally {
      await server.close();
    }
  });
});
