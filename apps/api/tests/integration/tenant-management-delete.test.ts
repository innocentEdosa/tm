import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { hashSessionToken, generateSessionToken } from "../../src/platform-auth/session";
import { resolveTenantBySubdomain } from "../../src/tenant-routing/resolve-tenant";
import { getTestPool } from "../helpers/pg";

describe("POST /tenants/:id/delete — soft delete with confirmation (spec FR-015; SC-006, SC-007)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("marks the tenant pending-deletion, hides it from routing, and revokes its sessions", async () => {
    const server = await buildTestServer();
    const tenantId = randomUUID();
    const tenantName = `Delete Success Test ${tenantId}`;
    const subdomain = `test-${tenantId}`;
    await seedTenant(tenantId, tenantName);

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

    const response = await server.inject({
      method: "POST",
      url: `/tenants/${tenantId}/delete`,
      headers: { cookie: cookieHeader },
      payload: { confirmTenantName: tenantName },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: { isPendingDeletion: boolean; purgeAt: string } };
    expect(body.data.isPendingDeletion).toBe(true);
    expect(new Date(body.data.purgeAt).getTime()).toBeGreaterThan(Date.now());

    const listResponse = await server.inject({
      method: "GET",
      url: "/tenants?pageSize=1000",
      headers: { cookie: cookieHeader },
    });
    const listBody = listResponse.json() as {
      data: { tenants: { id: string; isPendingDeletion: boolean }[] };
    };
    expect(listBody.data.tenants.find((t) => t.id === tenantId)?.isPendingDeletion).toBe(true);

    const routingResult = await resolveTenantBySubdomain(getTestPool(), subdomain);
    expect(routingResult.state).not.toBe("valid");

    const sessionRow = await withTenantTransaction(tenantId, async (client) => {
      const result = await client.query<{ revoked_at: Date | null }>(
        `SELECT revoked_at FROM user_sessions WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, userId],
      );
      return result.rows[0];
    });
    expect(sessionRow.revoked_at).not.toBeNull();

    await server.close();
  });
});
