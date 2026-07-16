import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool } from "../helpers/pg";
import { seedTenant, seedUserWithRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe("Super Admin Tenant Console — forbidden for non-Super-Admin callers (spec FR-007)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  const routes = (tenantId: string, memberId: string) => [
    { method: "GET" as const, url: `/tenants/${tenantId}` },
    { method: "GET" as const, url: `/tenants/${tenantId}/departments` },
    { method: "GET" as const, url: `/tenants/${tenantId}/roles` },
    { method: "GET" as const, url: `/tenants/${tenantId}/members` },
    { method: "POST" as const, url: `/tenants/${tenantId}/members/${memberId}/reset-password` },
  ];

  it("returns 401 for every console route with no session at all", async () => {
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      const memberId = randomUUID();
      for (const route of routes(tenantId, memberId)) {
        const response = await server.inject(route);
        expect(response.statusCode).toBe(401);
      }
    } finally {
      await server.close();
    }
  });

  it("returns 401 for every console route with a tenant-scoped user session instead of a Super Admin one", async () => {
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      await seedTenant(tenantId);
      const userId = randomUUID();
      await seedUserWithRole(tenantId, userId, ["manage_roles"]);

      for (const route of routes(tenantId, userId)) {
        const response = await server.inject({
          ...route,
          headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        });
        expect(response.statusCode).toBe(401);
      }
    } finally {
      await server.close();
    }
  });
});
