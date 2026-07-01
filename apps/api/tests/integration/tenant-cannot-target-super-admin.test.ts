import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

describe("tenant cannot target the platform Super Admin role (FR-007)", () => {
  let superAdminRoleId: string;

  beforeAll(async () => {
    // DATABASE_URL (migration/superuser role) bypasses RLS — needed only to look up the fixture id.
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const result = await client.query<{ id: string }>(
        "SELECT id FROM roles WHERE tenant_id IS NULL",
      );
      superAdminRoleId = result.rows[0].id;
    } finally {
      await client.end();
    }
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("PATCH and DELETE both return 404 for the Super Admin role's known id", async () => {
    const tenantId = randomUUID();
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["manage_roles"]);

    const server = await buildTestServer();
    try {
      const patchResponse = await server.inject({
        method: "PATCH",
        url: `/tenant/roles/${superAdminRoleId}`,
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
        payload: { name: "Hijacked" },
      });
      expect(patchResponse.statusCode).toBe(404);

      const deleteResponse = await server.inject({
        method: "DELETE",
        url: `/tenant/roles/${superAdminRoleId}`,
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
      });
      expect(deleteResponse.statusCode).toBe(404);
    } finally {
      await server.close();
    }

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const result = await client.query<{ name: string }>(
        "SELECT name FROM roles WHERE id = $1",
        [superAdminRoleId],
      );
      expect(result.rows[0].name).toBe("Super Admin");
    } finally {
      await client.end();
    }
  });
});
