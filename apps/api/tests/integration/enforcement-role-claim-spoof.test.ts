import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

/**
 * spec SC-003: a client-supplied role/permission claim must never influence an authorization
 * decision. `requirePermission` only ever queries `user_roles` -> `role_permissions` ->
 * `permissions` through `request.tenantDb` — it never reads any header or body field — so this
 * proves the point by construction: the spoofed claim below is inert.
 */
describe("enforcement: role/permission-claim spoofing has no effect", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("denies access based on the DB-verified role, ignoring a client-claimed permission header/body", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    // Actual DB-backed role grants nothing relevant.
    await seedUserWithRole(tenantId, userId, ["view_department_analytics"]);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/_internal/protected-demo",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: {
          // Spoofed claim: hoping the server trusts a client-asserted permission/role instead of
          // checking the DB.
          claimedPermissions: ["approve_enrollment"],
          role: "super_admin",
        },
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
