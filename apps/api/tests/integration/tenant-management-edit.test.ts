import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe("PATCH /tenants/:id — edits company details (spec FR-005)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("persists name/industry/contact changes and reflects them in the list", async () => {
    const server = await buildTestServer();
    const tenantId = randomUUID();
    await seedTenant(tenantId, `Edit Test ${tenantId}`);
    const { cookieHeader } = await seedSuperAdminSession();

    const patchResponse = await server.inject({
      method: "PATCH",
      url: `/tenants/${tenantId}`,
      headers: { cookie: cookieHeader },
      payload: {
        name: "Renamed Co",
        industry: "Manufacturing",
        primaryContact: { email: "new-contact@example.com" },
      },
    });

    expect(patchResponse.statusCode).toBe(200);
    const patchBody = patchResponse.json() as { success: boolean; data: { name: string } };
    expect(patchBody.success).toBe(true);
    expect(patchBody.data.name).toBe("Renamed Co");

    const listResponse = await server.inject({
      method: "GET",
      url: "/tenants?pageSize=1000",
      headers: { cookie: cookieHeader },
    });
    const listBody = listResponse.json() as {
      data: { tenants: { id: string; name: string; primaryContactEmail: string }[] };
    };
    const row = listBody.data.tenants.find((t) => t.id === tenantId);
    expect(row?.name).toBe("Renamed Co");
    expect(row?.primaryContactEmail).toBe("new-contact@example.com");

    await server.close();
  });

  it("returns 404 for a tenant id that does not exist", async () => {
    const server = await buildTestServer();
    const { cookieHeader } = await seedSuperAdminSession();

    const response = await server.inject({
      method: "PATCH",
      url: `/tenants/${randomUUID()}`,
      headers: { cookie: cookieHeader },
      payload: { name: "Doesn't matter" },
    });

    expect(response.statusCode).toBe(404);
    await server.close();
  });
});
