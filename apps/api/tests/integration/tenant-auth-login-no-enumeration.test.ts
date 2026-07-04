import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { hashPassword } from "../../src/platform-auth/password";

describe("POST /tenant-auth/login — no enumeration (FR-009, US2 AS2)", () => {
  const tenantId = randomUUID();
  const subdomain = `login-noenum-${randomUUID()}`;
  const email = `jo+${randomUUID()}@login-noenum.example`;

  afterAll(async () => {
    await closeTestPool();
  });

  it("seeds a tenant and a real user", async () => {
    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'No Enum Co', $2, 'Jo', 'jo@login-noenum.example')`,
        [tenantId, subdomain],
      );
      await client.query(
        `INSERT INTO users (tenant_id, full_name, email, password_hash) VALUES ($1, 'Jo Admin', $2, $3)`,
        [tenantId, email, await hashPassword("correct password")],
      );
    });
  });

  it("a wrong password and an unknown email return byte-identical responses", async () => {
    const server = await buildTestServer();
    try {
      const wrongPassword = await server.inject({
        method: "POST",
        url: `/tenant-auth/login?subdomain=${subdomain}`,
        payload: { email, password: "wrong password" },
      });
      const unknownEmail = await server.inject({
        method: "POST",
        url: `/tenant-auth/login?subdomain=${subdomain}`,
        payload: { email: `doesnotexist-${randomUUID()}@login-noenum.example`, password: "anything" },
      });

      expect(wrongPassword.statusCode).toBe(401);
      expect(unknownEmail.statusCode).toBe(401);
      expect(wrongPassword.body).toBe(unknownEmail.body);
    } finally {
      await server.close();
    }
  });
});
