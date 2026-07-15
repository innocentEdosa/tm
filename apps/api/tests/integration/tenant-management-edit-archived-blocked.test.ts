import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe("PATCH /tenants/:id — blocked while archived (spec FR-012)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns 409 for a tenant with archived_at set, independent of the Archive route (US3)", async () => {
    const server = await buildTestServer();
    const tenantId = randomUUID();
    await seedTenant(tenantId, "Archived Precondition Test");
    await withTenantTransaction(tenantId, async (client) => {
      await client.query("UPDATE tenants SET archived_at = now() WHERE id = $1", [tenantId]);
    });
    const { cookieHeader } = await seedSuperAdminSession();

    const response = await server.inject({
      method: "PATCH",
      url: `/tenants/${tenantId}`,
      headers: { cookie: cookieHeader },
      payload: { name: "Should not apply" },
    });

    expect(response.statusCode).toBe(409);
    await server.close();
  });
});
