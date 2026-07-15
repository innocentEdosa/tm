import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe("POST /tenants/:id/downgrade (spec FR-010, FR-011)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("steps an Active tenant to Trial, and rejects downgrading it again", async () => {
    const server = await buildTestServer();
    const tenantId = randomUUID();
    await seedTenant(tenantId, "Downgrade Test");
    await withTenantTransaction(tenantId, async (client) => {
      await client.query("UPDATE tenants SET status = 'active' WHERE id = $1", [tenantId]);
    });
    const { cookieHeader } = await seedSuperAdminSession();

    const first = await server.inject({
      method: "POST",
      url: `/tenants/${tenantId}/downgrade`,
      headers: { cookie: cookieHeader },
    });
    expect(first.statusCode).toBe(200);
    expect((first.json() as { data: { status: string } }).data.status).toBe("trial");

    const second = await server.inject({
      method: "POST",
      url: `/tenants/${tenantId}/downgrade`,
      headers: { cookie: cookieHeader },
    });
    expect(second.statusCode).toBe(409);

    await server.close();
  });
});
