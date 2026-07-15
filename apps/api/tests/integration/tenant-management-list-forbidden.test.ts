import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool } from "../helpers/pg";
import { seedUserWithRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe("GET /tenants — forbidden for non-Super-Admin callers (spec FR-002)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns 401 for an authenticated tenant-scoped user who is not a Super Admin", async () => {
    const server = await buildTestServer();
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedUserWithRole(tenantId, userId, ["approve_enrollment", "manage_roles"]);

    const response = await server.inject({
      method: "GET",
      url: "/tenants",
      headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
    });

    expect(response.statusCode).toBe(401);
    await server.close();
  });

  it("returns 401 for an unauthenticated caller", async () => {
    const server = await buildTestServer();

    const response = await server.inject({ method: "GET", url: "/tenants" });

    expect(response.statusCode).toBe(401);
    await server.close();
  });
});
