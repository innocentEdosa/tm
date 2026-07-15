import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe("PATCH /tenants/:id — subdomain conflict validation (spec FR-006)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns 409 and leaves the subdomain unchanged when the new subdomain is already taken", async () => {
    const server = await buildTestServer();
    const tenantAId = randomUUID();
    const tenantBId = randomUUID();
    await seedTenant(tenantAId, "Tenant A");
    await seedTenant(tenantBId, "Tenant B");
    const { cookieHeader } = await seedSuperAdminSession();

    const response = await server.inject({
      method: "PATCH",
      url: `/tenants/${tenantAId}`,
      headers: { cookie: cookieHeader },
      payload: { subdomain: `test-${tenantBId}` },
    });

    expect(response.statusCode).toBe(409);

    const listResponse = await server.inject({
      method: "GET",
      url: "/tenants?pageSize=1000",
      headers: { cookie: cookieHeader },
    });
    const listBody = listResponse.json() as { data: { tenants: { id: string; subdomain: string }[] } };
    const row = listBody.data.tenants.find((t) => t.id === tenantAId);
    expect(row?.subdomain).toBe(`test-${tenantAId}`);

    await server.close();
  });

  it("returns 409 when the new subdomain is a reserved word, same error path as taken", async () => {
    const server = await buildTestServer();
    const tenantId = randomUUID();
    await seedTenant(tenantId, "Tenant Reserved Test");
    const { cookieHeader } = await seedSuperAdminSession();

    const response = await server.inject({
      method: "PATCH",
      url: `/tenants/${tenantId}`,
      headers: { cookie: cookieHeader },
      payload: { subdomain: "billing" },
    });

    expect(response.statusCode).toBe(409);
    await server.close();
  });
});
