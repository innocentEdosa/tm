import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool } from "../helpers/pg";
import { seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe("Super Admin Tenant Console — 404 for a tenant id that does not exist (spec Edge Cases)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns a clear 404 (not a raw error) on every console read route", async () => {
    const tenantId = randomUUID();
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const routes = [
        `/tenants/${tenantId}`,
        `/tenants/${tenantId}/departments`,
        `/tenants/${tenantId}/roles`,
        `/tenants/${tenantId}/members`,
      ];
      for (const url of routes) {
        const response = await server.inject({ method: "GET", url, headers: { cookie: cookieHeader } });
        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ success: false });
      }

      const resetResponse = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/members/${randomUUID()}/reset-password`,
        headers: { cookie: cookieHeader },
      });
      expect(resetResponse.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });
});
