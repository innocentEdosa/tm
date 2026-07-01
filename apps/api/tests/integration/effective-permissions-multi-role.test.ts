import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedRole, assignRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

/**
 * Proves union resolution (FR-008) through the real `requirePermission`/`request.tenantDb` path —
 * not just the pure-function unit test (tests/unit/effective-permissions.test.ts).
 */
describe("effective permissions: union across multiple assigned roles", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("grants access when only the SECOND of a user's two roles has the required permission", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();

    const { roleId: roleWithoutPermission } = await seedRole(tenantId, "Role Without", [
      "view_department_analytics",
    ]);
    const { roleId: roleWithPermission } = await seedRole(tenantId, "Role With", [
      "approve_enrollment",
    ]);

    await assignRole(tenantId, userId, roleWithoutPermission);
    await assignRole(tenantId, userId, roleWithPermission);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/_internal/protected-demo",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });
});
