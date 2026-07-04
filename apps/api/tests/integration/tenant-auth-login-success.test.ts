import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { hashPassword } from "../../src/platform-auth/password";

describe("POST /tenant-auth/login — success (US2 AS1)", () => {
  const tenantId = randomUUID();
  const subdomain = `login-success-${randomUUID()}`;
  const email = `jo+${randomUUID()}@login-success.example`;
  const password = "correct horse battery staple";

  afterAll(async () => {
    await closeTestPool();
  });

  it("seeds a tenant and a user with a real password hash directly (bypassing OTP, US5's concern)", async () => {
    const passwordHash = await hashPassword(password);
    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Login Success Co', $2, 'Jo', 'jo@login-success.example')`,
        [tenantId, subdomain],
      );
      await client.query(
        `INSERT INTO users (tenant_id, full_name, email, password_hash) VALUES ($1, 'Jo Admin', $2, $3)`,
        [tenantId, email, passwordHash],
      );
    });
  });

  it("valid credentials return a session cookie scoped to that tenant (FR-011)", async () => {
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/tenant-auth/login?subdomain=${subdomain}`,
        payload: { email, password },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["set-cookie"]).toMatch(/^tm_tenant_session=/);
      expect(response.json().data.mustChangePassword).toBe(false);
    } finally {
      await server.close();
    }
  });
});
