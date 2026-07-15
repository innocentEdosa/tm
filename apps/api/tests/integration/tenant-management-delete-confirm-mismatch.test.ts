import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe("POST /tenants/:id/delete — confirmation must match (spec FR-013, FR-014)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns 400 and leaves the tenant unchanged when confirmTenantName is missing", async () => {
    const server = await buildTestServer();
    const tenantId = randomUUID();
    await seedTenant(tenantId, "Delete Mismatch Test");
    const { cookieHeader } = await seedSuperAdminSession();

    const response = await server.inject({
      method: "POST",
      url: `/tenants/${tenantId}/delete`,
      headers: { cookie: cookieHeader },
      payload: {},
    });
    expect(response.statusCode).toBe(400);

    const listResponse = await server.inject({
      method: "GET",
      url: "/tenants?pageSize=1000",
      headers: { cookie: cookieHeader },
    });
    const listBody = listResponse.json() as {
      data: { tenants: { id: string; isPendingDeletion: boolean }[] };
    };
    expect(listBody.data.tenants.find((t) => t.id === tenantId)?.isPendingDeletion).toBe(false);

    await server.close();
  });

  it("returns 400 when confirmTenantName does not exactly match the tenant's name", async () => {
    const server = await buildTestServer();
    const tenantId = randomUUID();
    await seedTenant(tenantId, "Delete Mismatch Test Two");
    const { cookieHeader } = await seedSuperAdminSession();

    const response = await server.inject({
      method: "POST",
      url: `/tenants/${tenantId}/delete`,
      headers: { cookie: cookieHeader },
      payload: { confirmTenantName: "Wrong Name" },
    });
    expect(response.statusCode).toBe(400);

    await server.close();
  });
});
