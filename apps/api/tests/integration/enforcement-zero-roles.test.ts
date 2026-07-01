import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { closeTestPool } from "../helpers/pg";

describe("enforcement: zero roles (deny by default, FR-010)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns 403 for a user with no user_roles rows at all", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID(); // never assigned any role

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/_internal/protected-demo",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
