import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb, withTenantTransaction } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { users } from "../../src/db/schema/users";
import { userRoles } from "../../src/db/schema/roles";
import { generateSessionToken, hashSessionToken } from "../../src/platform-auth/session";
import { TENANT_USER_COOKIE_NAME } from "../../src/tenant-auth/cookies";

describe("POST /tenants/:id/members/:memberId/reset-password — session invalidation (spec FR-010)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("revokes the member's existing active session immediately", async () => {
    const tenantId = randomUUID();
    const subdomain = `test-${tenantId}`;
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    const memberId = await withTenantDb(tenantId, async (db) => {
      const [member] = await db
        .insert(users)
        .values({ tenantId, fullName: "Session Holder", email: `session-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId, userId: member.id, roleId });
      return member.id;
    });

    const token = generateSessionToken();
    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO user_sessions (tenant_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 day')`,
        [tenantId, memberId, hashSessionToken(token)],
      );
    });
    const tenantUserCookie = `${TENANT_USER_COOKIE_NAME}=${token}`;

    const server = await buildTestServer();
    try {
      const before = await server.inject({
        method: "GET",
        url: `/tenant-auth/me?subdomain=${subdomain}`,
        headers: { cookie: tenantUserCookie },
      });
      expect(before.statusCode).toBe(200);

      const { cookieHeader: superAdminCookie } = await seedSuperAdminSession();
      const resetResponse = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/members/${memberId}/reset-password`,
        headers: { cookie: superAdminCookie },
      });
      expect(resetResponse.statusCode).toBe(200);

      const after = await server.inject({
        method: "GET",
        url: `/tenant-auth/me?subdomain=${subdomain}`,
        headers: { cookie: tenantUserCookie },
      });
      expect(after.statusCode).toBe(401);
    } finally {
      await server.close();
    }
  });
});
