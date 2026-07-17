import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe("POST /tenants/:id/members — validation (spec FR-002, Edge Cases)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns 400 when fullName, email, or roleId is missing", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    const { cookieHeader } = await seedSuperAdminSession();

    const server = await buildTestServer();
    try {
      const missingRole = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/members`,
        headers: { cookie: cookieHeader },
        payload: { fullName: "No Role", email: `no-role-${randomUUID()}@example.com` },
      });
      expect(missingRole.statusCode).toBe(400);

      const missingEmail = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/members`,
        headers: { cookie: cookieHeader },
        payload: { fullName: "No Email", roleId },
      });
      expect(missingEmail.statusCode).toBe(400);

      const missingName = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/members`,
        headers: { cookie: cookieHeader },
        payload: { email: `no-name-${randomUUID()}@example.com`, roleId },
      });
      expect(missingName.statusCode).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("returns 404 for a tenant id that does not exist", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/tenants/${randomUUID()}/members`,
        headers: { cookie: cookieHeader },
        payload: { fullName: "X", email: `x-${randomUUID()}@example.com`, roleId: randomUUID() },
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });
});
