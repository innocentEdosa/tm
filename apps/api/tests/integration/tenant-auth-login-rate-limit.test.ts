import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { hashPassword } from "../../src/platform-auth/password";

describe("POST /tenant-auth/login — rate limiting (FR-010, US2 AS3)", () => {
  const tenantId = randomUUID();
  const subdomain = `login-ratelimit-${randomUUID()}`;
  const email = `jo+${randomUUID()}@login-ratelimit.example`;
  const password = "correct horse battery staple";

  afterAll(async () => {
    await closeTestPool();
  });

  it("seeds a tenant and a real user", async () => {
    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Rate Limit Co', $2, 'Jo', 'jo@login-ratelimit.example')`,
        [tenantId, subdomain],
      );
      await client.query(
        `INSERT INTO users (tenant_id, full_name, email, password_hash) VALUES ($1, 'Jo Admin', $2, $3)`,
        [tenantId, email, await hashPassword(password)],
      );
    });
  });

  it("locks out after 5 failures; the 6th attempt with the correct password still 429s", async () => {
    const server = await buildTestServer();
    try {
      for (let i = 0; i < 5; i++) {
        const response = await server.inject({
          method: "POST",
          url: `/tenant-auth/login?subdomain=${subdomain}`,
          payload: { email, password: "wrong" },
        });
        expect(response.statusCode).toBe(401);
      }

      const sixthAttempt = await server.inject({
        method: "POST",
        url: `/tenant-auth/login?subdomain=${subdomain}`,
        payload: { email, password },
      });
      expect(sixthAttempt.statusCode).toBe(429);
    } finally {
      await server.close();
    }
  });
});
