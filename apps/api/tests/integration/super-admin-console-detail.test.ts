import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe("GET /tenants/:id — company detail (spec FR-003)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns the tenant's company-detail fields", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId, `Detail Test ${tenantId}`);
    const { cookieHeader } = await seedSuperAdminSession();

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: `/tenants/${tenantId}`,
        headers: { cookie: cookieHeader },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toMatchObject({
        id: tenantId,
        subdomain: `test-${tenantId}`,
        status: "trial",
        isArchived: false,
        isPendingDeletion: false,
        primaryContactEmail: `contact-${tenantId}@example.com`,
      });
    } finally {
      await server.close();
    }
  });

  it("returns 404 for a tenant id that does not exist", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: `/tenants/${randomUUID()}`,
        headers: { cookie: cookieHeader },
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });
});
