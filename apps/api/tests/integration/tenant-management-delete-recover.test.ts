import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { resolveTenantBySubdomain } from "../../src/tenant-routing/resolve-tenant";
import { getTestPool } from "../helpers/pg";

describe("POST /tenants/:id/recover — undo a pending deletion within the grace period (spec FR-015a; SC-008)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("restores the tenant to full reachability with prior data intact", async () => {
    const server = await buildTestServer();
    const tenantId = randomUUID();
    const tenantName = `Recover Test ${tenantId}`;
    const subdomain = `test-${tenantId}`;
    await seedTenant(tenantId, tenantName);
    const { cookieHeader } = await seedSuperAdminSession();

    const deleteResponse = await server.inject({
      method: "POST",
      url: `/tenants/${tenantId}/delete`,
      headers: { cookie: cookieHeader },
      payload: { confirmTenantName: tenantName },
    });
    expect(deleteResponse.statusCode).toBe(200);

    const recoverResponse = await server.inject({
      method: "POST",
      url: `/tenants/${tenantId}/recover`,
      headers: { cookie: cookieHeader },
    });
    expect(recoverResponse.statusCode).toBe(200);
    expect((recoverResponse.json() as { data: { isPendingDeletion: boolean } }).data.isPendingDeletion).toBe(
      false,
    );

    const routingResult = await resolveTenantBySubdomain(getTestPool(), subdomain);
    expect(routingResult.state).toBe("valid");
    expect(routingResult.tenantName).toBe(tenantName);

    await server.close();
  });

  it("returns 409 when the tenant is not currently pending deletion", async () => {
    const server = await buildTestServer();
    const tenantId = randomUUID();
    await seedTenant(tenantId, "Recover Not Pending Test");
    const { cookieHeader } = await seedSuperAdminSession();

    const response = await server.inject({
      method: "POST",
      url: `/tenants/${tenantId}/recover`,
      headers: { cookie: cookieHeader },
    });

    expect(response.statusCode).toBe(409);
    await server.close();
  });
});
