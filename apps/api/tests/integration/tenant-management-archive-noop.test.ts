import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe("POST /tenants/:id/archive — idempotent (spec FR-009)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("archiving an already-archived tenant returns 200, not an error", async () => {
    const server = await buildTestServer();
    const tenantId = randomUUID();
    await seedTenant(tenantId, "Archive Noop Test");
    const { cookieHeader } = await seedSuperAdminSession();

    const first = await server.inject({
      method: "POST",
      url: `/tenants/${tenantId}/archive`,
      headers: { cookie: cookieHeader },
    });
    expect(first.statusCode).toBe(200);

    const second = await server.inject({
      method: "POST",
      url: `/tenants/${tenantId}/archive`,
      headers: { cookie: cookieHeader },
    });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { data: { isArchived: boolean } }).data.isArchived).toBe(true);

    await server.close();
  });
});
