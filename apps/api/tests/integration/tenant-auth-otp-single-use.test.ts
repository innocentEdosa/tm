import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { hashPassword } from "../../src/platform-auth/password";

describe("OTP is single-use (FR-013a, US5 AS4)", () => {
  const tenantId = randomUUID();
  const subdomain = `otp-single-${randomUUID()}`;
  const email = `jo+${randomUUID()}@otp-single.example`;
  const otp = "one-time-password-value";
  const realPassword = "a brand new real password";

  afterAll(async () => {
    await closeTestPool();
  });

  it("seeds a tenant and a user in the must-change-password (OTP) state", async () => {
    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'OTP Single Co', $2, 'Jo', 'jo@otp-single.example')`,
        [tenantId, subdomain],
      );
      await client.query(
        `INSERT INTO users (tenant_id, full_name, email, password_hash, must_change_password, otp_expires_at)
         VALUES ($1, 'Jo Admin', $2, $3, true, now() + interval '72 hours')`,
        [tenantId, email, await hashPassword(otp)],
      );
    });
  });

  it("after set-password completes, the original OTP no longer authenticates", async () => {
    const server = await buildTestServer();
    try {
      const loginResponse = await server.inject({
        method: "POST",
        url: `/tenant-auth/login?subdomain=${subdomain}`,
        payload: { email, password: otp },
      });
      const cookie = (loginResponse.headers["set-cookie"] as string).split(";")[0];

      const setPasswordResponse = await server.inject({
        method: "POST",
        url: `/tenant-auth/set-password?subdomain=${subdomain}`,
        headers: { cookie },
        payload: { newPassword: realPassword },
      });
      expect(setPasswordResponse.statusCode).toBe(204);

      const loginWithOldOtp = await server.inject({
        method: "POST",
        url: `/tenant-auth/login?subdomain=${subdomain}`,
        payload: { email, password: otp },
      });
      expect(loginWithOldOtp.statusCode).toBe(401);

      const loginWithNewPassword = await server.inject({
        method: "POST",
        url: `/tenant-auth/login?subdomain=${subdomain}`,
        payload: { email, password: realPassword },
      });
      expect(loginWithNewPassword.statusCode).toBe(200);
      expect(loginWithNewPassword.json().data.mustChangePassword).toBe(false);
    } finally {
      await server.close();
    }
  });
});
