import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe("Concurrent tenant-management actions apply consistently (spec FR-017)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("archive and downgrade fired concurrently against the same tenant both apply, neither lost", async () => {
    const server = await buildTestServer();
    const tenantId = randomUUID();
    await seedTenant(tenantId, "Concurrent Actions Test");
    await withTenantTransaction(tenantId, async (client) => {
      await client.query("UPDATE tenants SET status = 'active' WHERE id = $1", [tenantId]);
    });
    const { cookieHeader } = await seedSuperAdminSession();

    const [archiveResponse, downgradeResponse] = await Promise.all([
      server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/archive`,
        headers: { cookie: cookieHeader },
      }),
      server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/downgrade`,
        headers: { cookie: cookieHeader },
      }),
    ]);

    expect([archiveResponse.statusCode, downgradeResponse.statusCode].every((s) => s === 200)).toBe(
      true,
    );

    const finalState = await withTenantTransaction(tenantId, async (client) => {
      const result = await client.query<{ status: string; archived_at: Date | null }>(
        "SELECT status, archived_at FROM tenants WHERE id = $1",
        [tenantId],
      );
      return result.rows[0];
    });
    expect(finalState.status).toBe("trial");
    expect(finalState.archived_at).not.toBeNull();

    await server.close();
  });
});
