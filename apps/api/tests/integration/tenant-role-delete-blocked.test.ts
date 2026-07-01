import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { buildTestServer } from "../helpers/test-server";
import { seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { roles } from "../../src/db/schema/roles";

describe("tenant role deletion blocked when users are assigned (FR-012)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns 409 and does not delete the role", async () => {
    const tenantId = randomUUID();
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["manage_roles"]);

    // A second user assigned a role — that role must not be deletable while this assignment exists.
    const assignedUserId = randomUUID();
    const { roleId } = await seedUserWithRole(tenantId, assignedUserId, ["approve_enrollment"]);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "DELETE",
        url: `/tenant/roles/${roleId}`,
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(409);
    } finally {
      await server.close();
    }

    const stillExists = await withTenantDb(tenantId, async (db) => {
      const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId));
      return role;
    });
    expect(stillExists).toBeDefined();
  });
});
