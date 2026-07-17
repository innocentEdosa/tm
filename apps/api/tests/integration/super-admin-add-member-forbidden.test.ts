import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool } from "../helpers/pg";
import { seedTenant, seedUserWithRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe("POST /tenants/:id/members — forbidden for non-Super-Admin callers (spec FR-009)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns 401 with no session at all", async () => {
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/tenants/${randomUUID()}/members`,
        payload: { fullName: "X", email: `x-${randomUUID()}@example.com`, roleId: randomUUID() },
      });
      expect(response.statusCode).toBe(401);
    } finally {
      await server.close();
    }
  });

  it("returns 401 for a tenant-scoped user session instead of a Super Admin one", async () => {
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      await seedTenant(tenantId);
      const userId = randomUUID();
      await seedUserWithRole(tenantId, userId, ["manage_team_members"]);

      const response = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/members`,
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: { fullName: "X", email: `x-${randomUUID()}@example.com`, roleId: randomUUID() },
      });
      expect(response.statusCode).toBe(401);
    } finally {
      await server.close();
    }
  });
});
