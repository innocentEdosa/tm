import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

describe("department permission gating (spec FR-011/FR-012/FR-013)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns 403 for a user with neither department.view nor department.manage", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUserWithRole(tenantId, userId, []);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: "/tenant/departments",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("allows read but denies write for a user with only department.view", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUserWithRole(tenantId, userId, ["department.view"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

      const list = await server.inject({ method: "GET", url: "/tenant/departments", headers });
      expect(list.statusCode).toBe(200);

      const create = await server.inject({
        method: "POST",
        url: "/tenant/departments",
        headers,
        payload: { name: `Dept ${randomUUID()}` },
      });
      expect(create.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
