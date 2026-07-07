import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { buildTestServer } from "../helpers/test-server";
import { seedUserWithRole, seedRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { roles } from "../../src/db/schema/roles";

/** `tenant-role-delete-blocked.test.ts` (Spec 001) already covers the 409-with-members-assigned
 * case at the endpoint level. This file adds the complementary, previously-uncovered success path
 * (spec FR-012: a custom role with zero members deletes immediately) — the two together satisfy
 * spec User Story 4's full "204 with zero / 409 with members" contract. */
describe("DELETE /tenant/roles/:roleId succeeds immediately for a custom role with zero members (spec FR-012)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns 204 and removes the role", async () => {
    const tenantId = randomUUID();
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["manage_roles"]);
    const { roleId } = await seedRole(tenantId, "Content Reviewer", ["edit_content_library"]);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "DELETE",
        url: `/tenant/roles/${roleId}`,
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(204);
    } finally {
      await server.close();
    }

    const stillExists = await withTenantDb(tenantId, async (db) => {
      const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId));
      return role;
    });
    expect(stillExists).toBeUndefined();
  });
});
