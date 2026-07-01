import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

describe("enforcement: permission denied", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns 403 when the user's role does not include approve_enrollment", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedUserWithRole(tenantId, userId, ["view_department_analytics"]);

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
