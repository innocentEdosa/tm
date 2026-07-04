import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { hashPassword } from "../../src/platform-auth/password";

describe("OTP login forces a password change before anything else (FR-013a, US5 AS3)", () => {
  const tenantId = randomUUID();
  const subdomain = `otp-forces-${randomUUID()}`;
  const email = `jo+${randomUUID()}@otp-forces.example`;
  const otp = "one-time-password-value";

  afterAll(async () => {
    await closeTestPool();
  });

  it("seeds a tenant and a user in the must-change-password (OTP) state", async () => {
    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'OTP Forces Co', $2, 'Jo', 'jo@otp-forces.example')`,
        [tenantId, subdomain],
      );
      await client.query(
        `INSERT INTO users (tenant_id, full_name, email, password_hash, must_change_password, otp_expires_at)
         VALUES ($1, 'Jo Admin', $2, $3, true, now() + interval '72 hours')`,
        [tenantId, email, await hashPassword(otp)],
      );
    });
  });

  it("logs in successfully (mustChangePassword: true) but other guarded routes reject the session", async () => {
    const server = await buildTestServer();
    try {
      const loginResponse = await server.inject({
        method: "POST",
        url: `/tenant-auth/login?subdomain=${subdomain}`,
        payload: { email, password: otp },
      });
      expect(loginResponse.statusCode).toBe(200);
      expect(loginResponse.json().data.mustChangePassword).toBe(true);
      const cookie = (loginResponse.headers["set-cookie"] as string).split(";")[0];

      // /me is deliberately allowed regardless of mustChangePassword, so the frontend can detect
      // the state — confirm it still reports mustChangePassword: true.
      const meResponse = await server.inject({
        method: "GET",
        url: `/tenant-auth/me?subdomain=${subdomain}`,
        headers: { cookie },
      });
      expect(meResponse.statusCode).toBe(200);
      expect(meResponse.json().data.mustChangePassword).toBe(true);

      // Any other guarded route must reject while must_change_password is true.
      const settingsResponse = await server.inject({
        method: "GET",
        url: `/tenant-auth/settings/methods?subdomain=${subdomain}`,
        headers: { cookie },
      });
      expect(settingsResponse.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
