import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { hashSessionToken, generateSessionToken } from "../../src/platform-auth/session";
import { TENANT_USER_COOKIE_NAME } from "../../src/tenant-auth/cookies";

describe("Archiving a tenant immediately blocks its already-established sessions (spec FR-007; SC-007)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("a session valid before archive is rejected by the very next request after archive", async () => {
    const server = await buildTestServer();
    const tenantId = randomUUID();
    const subdomain = `test-${tenantId}`;
    await seedTenant(tenantId, "Session Block Test");

    const userId = randomUUID();
    const token = generateSessionToken();
    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO users (id, tenant_id, full_name, email) VALUES ($1, $2, 'Test User', $3)`,
        [userId, tenantId, `user-${userId}@example.com`],
      );
      await client.query(
        `INSERT INTO user_sessions (tenant_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 day')`,
        [tenantId, userId, hashSessionToken(token)],
      );
    });

    const tenantUserCookie = `${TENANT_USER_COOKIE_NAME}=${token}`;

    // Sanity check: the session works before the tenant is archived.
    const before = await server.inject({
      method: "GET",
      url: `/tenant-auth/me?subdomain=${subdomain}`,
      headers: { cookie: tenantUserCookie },
    });
    expect(before.statusCode).toBe(200);

    const { cookieHeader: superAdminCookie } = await seedSuperAdminSession();
    const archiveResponse = await server.inject({
      method: "POST",
      url: `/tenants/${tenantId}/archive`,
      headers: { cookie: superAdminCookie },
    });
    expect(archiveResponse.statusCode).toBe(200);

    // Same cookie, same session token, replayed immediately after archive — must be rejected now,
    // not merely on a future re-login (this is the T009 tenant-user-context.ts amendment being
    // exercised, not just the bulk session revoke).
    const after = await server.inject({
      method: "GET",
      url: `/tenant-auth/me?subdomain=${subdomain}`,
      headers: { cookie: tenantUserCookie },
    });
    expect(after.statusCode).toBe(401);

    await server.close();
  });
});
