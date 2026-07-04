import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";

describe("PUT /tenant-auth/settings/methods — at least one enabled (FR-006)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("rejects a request that would leave zero methods enabled, leaving the existing one untouched", async () => {
    const tenantId = randomUUID();
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["manage_authentication_settings"]);
    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Min One Co', $2, 'Jo', 'jo@minone.example')`,
        [tenantId, `min-one-${randomUUID()}`],
      );
      await client.query(`INSERT INTO tenant_auth_methods (tenant_id, method) VALUES ($1, 'email_password')`, [
        tenantId,
      ]);
    });

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PUT",
        url: "/tenant-auth/settings/methods",
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
        payload: { methods: [] },
      });
      expect(response.statusCode).toBe(409);

      const getResponse = await server.inject({
        method: "GET",
        url: "/tenant-auth/settings/methods",
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
      });
      expect(getResponse.json().data.methods).toEqual(["email_password"]);
    } finally {
      await server.close();
    }
  });
});
