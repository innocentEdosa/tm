import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedUserWithRole, seedRole, assignRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

/** The frontend's decision to show the impact-warning dialog (spec FR-010/FR-011) is driven entirely
 * by `GET /tenant/roles`'s `memberCount` for the role being edited — this test proves that count is
 * accurate immediately after real assignments change, which is the only thing that determination
 * actually depends on. */
describe("GET /tenant/roles memberCount accuracy (spec FR-010/FR-011)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("reports 0 for a custom role with no assignments, then reflects real assignments immediately", async () => {
    const tenantId = randomUUID();
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["manage_roles"]);
    const { roleId } = await seedRole(tenantId, "Content Reviewer", ["edit_content_library"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };

      const before = await server.inject({ method: "GET", url: "/tenant/roles", headers });
      const beforeRole = before.json().data.find((r: { id: string }) => r.id === roleId);
      expect(beforeRole.memberCount).toBe(0);

      await assignRole(tenantId, randomUUID(), roleId);
      await assignRole(tenantId, randomUUID(), roleId);

      const after = await server.inject({ method: "GET", url: "/tenant/roles", headers });
      const afterRole = after.json().data.find((r: { id: string }) => r.id === roleId);
      expect(afterRole.memberCount).toBe(2);
    } finally {
      await server.close();
    }
  });
});
