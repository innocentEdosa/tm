import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { hashSessionToken, generateSessionToken } from "../../src/platform-auth/session";

describe("POST /tenants/:id/archive and /reactivate (spec FR-007, FR-008; SC-004)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("archiving revokes live sessions and preserves data; reactivating restores it", async () => {
    const server = await buildTestServer();
    const tenantId = randomUUID();
    await seedTenant(tenantId, "Archive Round Trip");

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

    const { cookieHeader } = await seedSuperAdminSession();

    const archiveResponse = await server.inject({
      method: "POST",
      url: `/tenants/${tenantId}/archive`,
      headers: { cookie: cookieHeader },
    });
    expect(archiveResponse.statusCode).toBe(200);
    expect((archiveResponse.json() as { data: { isArchived: boolean } }).data.isArchived).toBe(true);

    const sessionRow = await withTenantTransaction(tenantId, async (client) => {
      const result = await client.query<{ revoked_at: Date | null }>(
        `SELECT revoked_at FROM user_sessions WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, userId],
      );
      return result.rows[0];
    });
    expect(sessionRow.revoked_at).not.toBeNull();

    const reactivateResponse = await server.inject({
      method: "POST",
      url: `/tenants/${tenantId}/reactivate`,
      headers: { cookie: cookieHeader },
    });
    expect(reactivateResponse.statusCode).toBe(200);
    expect((reactivateResponse.json() as { data: { isArchived: boolean } }).data.isArchived).toBe(false);

    const userStillExists = await withTenantTransaction(tenantId, async (client) => {
      const result = await client.query(`SELECT id FROM users WHERE id = $1`, [userId]);
      return result.rows.length > 0;
    });
    expect(userStillExists).toBe(true);

    await server.close();
  });

  it("returns 404 for a tenant id that does not exist", async () => {
    const server = await buildTestServer();
    const { cookieHeader } = await seedSuperAdminSession();

    const response = await server.inject({
      method: "POST",
      url: `/tenants/${randomUUID()}/archive`,
      headers: { cookie: cookieHeader },
    });

    expect(response.statusCode).toBe(404);
    await server.close();
  });
});
