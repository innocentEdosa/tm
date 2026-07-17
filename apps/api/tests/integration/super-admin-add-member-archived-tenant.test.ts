import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe("POST /tenants/:id/members — works regardless of tenant status (spec FR-010)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("succeeds identically after the tenant has been archived", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId, `Archived Add Member Test ${tenantId}`);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    const { cookieHeader } = await seedSuperAdminSession();

    const server = await buildTestServer();
    try {
      const archiveResponse = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/archive`,
        headers: { cookie: cookieHeader },
      });
      expect(archiveResponse.statusCode).toBe(200);

      const response = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/members`,
        headers: { cookie: cookieHeader },
        payload: { fullName: "Archived Tenant Member", email: `archived-${randomUUID()}@example.com`, roleId },
      });
      expect(response.statusCode).toBe(201);
    } finally {
      await server.close();
    }
  });
});
