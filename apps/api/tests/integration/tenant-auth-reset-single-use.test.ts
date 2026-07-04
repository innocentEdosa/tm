import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { hashSessionToken } from "../../src/platform-auth/session";

describe("POST /tenant-auth/reset-password — single use (FR-014, US4 AS2)", () => {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const subdomain = `reset-single-${randomUUID()}`;
  const rawToken = randomUUID();

  afterAll(async () => {
    await closeTestPool();
  });

  it("seeds a tenant, user, and a valid reset token directly (bypassing email delivery)", async () => {
    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Reset Single Co', $2, 'Jo', 'jo@reset-single.example')`,
        [tenantId, subdomain],
      );
      await client.query(
        `INSERT INTO users (id, tenant_id, full_name, email) VALUES ($1, $2, 'Jo Admin', 'jo@reset-single.example')`,
        [userId, tenantId],
      );
      await client.query(
        `INSERT INTO password_reset_tokens (tenant_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 hour')`,
        [tenantId, userId, hashSessionToken(rawToken)],
      );
    });
  });

  it("works once; a second use of the same token is rejected", async () => {
    const server = await buildTestServer();
    try {
      const first = await server.inject({
        method: "POST",
        url: `/tenant-auth/reset-password?subdomain=${subdomain}`,
        payload: { token: rawToken, newPassword: "a brand new password" },
      });
      expect(first.statusCode).toBe(200);

      const second = await server.inject({
        method: "POST",
        url: `/tenant-auth/reset-password?subdomain=${subdomain}`,
        payload: { token: rawToken, newPassword: "yet another password" },
      });
      expect(second.statusCode).toBe(401);
    } finally {
      await server.close();
    }
  });
});
