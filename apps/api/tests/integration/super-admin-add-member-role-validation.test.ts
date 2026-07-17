import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe("POST /tenants/:id/members — role validation (spec FR-003, research.md §1)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns 422 for a role id that does not exist at all", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { cookieHeader } = await seedSuperAdminSession();

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/members`,
        headers: { cookie: cookieHeader },
        payload: { fullName: "X", email: `x-${randomUUID()}@example.com`, roleId: randomUUID() },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().message).toBe("Role not found");
    } finally {
      await server.close();
    }
  });

  it("returns 422 (not silently accepted) for a role belonging to a different tenant — the cross-tenant-leak regression", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    await seedTenant(tenantA);
    await seedTenant(tenantB);
    const { roleId: roleBId } = await seedRole(tenantB, `Role B ${randomUUID()}`);
    const { cookieHeader } = await seedSuperAdminSession();

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/tenants/${tenantA}/members`,
        headers: { cookie: cookieHeader },
        payload: { fullName: "X", email: `x-${randomUUID()}@example.com`, roleId: roleBId },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().message).toBe("Role not found");
    } finally {
      await server.close();
    }
  });
});
