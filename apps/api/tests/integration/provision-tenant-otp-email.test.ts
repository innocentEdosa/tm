import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getTestPool, closeTestPool, withTenantTransaction } from "../helpers/pg";
import { provisionTenant } from "../../src/provisioning/provision-tenant";

describe("provisionTenant — OTP bootstrap (Tenant Authentication Configuration FR-013, US5 AS1)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("the admin account requires a password change and has a hashed credential set", async () => {
    const subdomain = `otp-provision-${randomUUID()}`;
    const result = await provisionTenant(getTestPool(), {
      company: {
        name: "OTP Provision Co",
        subdomain,
        primaryContact: { name: "Jo", email: "jo@otpprovision.example" },
      },
      admin: { fullName: "Jo Admin", email: `jo+${randomUUID()}@otpprovision.example` },
    });

    const row = await withTenantTransaction(result.tenant.id, async (client) => {
      const rows = await client.query<{
        password_hash: string | null;
        must_change_password: boolean;
        otp_expires_at: Date | null;
      }>(
        "SELECT password_hash, must_change_password, otp_expires_at FROM users WHERE id = $1",
        [result.admin.id],
      );
      return rows.rows[0];
    });

    expect(row.password_hash).not.toBeNull();
    expect(row.must_change_password).toBe(true);
    expect(row.otp_expires_at).not.toBeNull();
    expect(row.otp_expires_at!.getTime()).toBeGreaterThan(Date.now());
  });
});
