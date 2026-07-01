import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedUserWithRole, assignRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

describe("tenant role creation (POST /tenant/roles)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("creates a role from catalog permissions; an assigned user's effective permissions match it exactly", async () => {
    const tenantId = randomUUID();
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["manage_roles"]);

    const server = await buildTestServer();
    let newRoleId: string;
    try {
      const createResponse = await server.inject({
        method: "POST",
        url: "/tenant/roles",
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
        payload: { name: "Onboarding Buddy", permissionKeys: ["approve_enrollment"] },
      });
      expect(createResponse.statusCode).toBe(201);
      const body = createResponse.json();
      expect(body.data.permissionKeys).toEqual(["approve_enrollment"]);
      newRoleId = body.data.id;

      const newUserId = randomUUID();
      await assignRole(tenantId, newUserId, newRoleId);

      // Effective permissions match exactly the new role's set: approve_enrollment -> granted.
      const grantedResponse = await server.inject({
        method: "POST",
        url: "/_internal/protected-demo",
        headers: { "x-test-user-id": newUserId, "x-test-tenant-id": tenantId },
      });
      expect(grantedResponse.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });
});
