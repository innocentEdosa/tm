import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe("POST /tenants/:id/downgrade — blocked while archived (spec FR-012)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns 409 for an archived tenant, even if it is otherwise Active", async () => {
    const server = await buildTestServer();
    const tenantId = randomUUID();
    await seedTenant(tenantId, "Downgrade Archived Test");
    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        "UPDATE tenants SET status = 'active', archived_at = now() WHERE id = $1",
        [tenantId],
      );
    });
    const { cookieHeader } = await seedSuperAdminSession();

    const response = await server.inject({
      method: "POST",
      url: `/tenants/${tenantId}/downgrade`,
      headers: { cookie: cookieHeader },
    });

    expect(response.statusCode).toBe(409);
    await server.close();
  });
});
