import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

describe("GET /tenant/team — permission gating (spec 012 FR-001)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns 403 for a user holding neither team.view.all nor team.view.department", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUserWithRole(tenantId, userId, []);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: "/tenant/team",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("allows access for a user holding only team.view.department", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUserWithRole(tenantId, userId, ["team.view.department"]);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: "/tenant/team",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });
});
