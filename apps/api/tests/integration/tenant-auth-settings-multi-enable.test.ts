import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";

describe("PUT /tenant-auth/settings/methods — multiple methods simultaneously (FR-002)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("enables a second method without disabling the first; both appear on a subsequent GET", async () => {
    const tenantId = randomUUID();
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["manage_authentication_settings"]);
    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Multi Enable Co', $2, 'Jo', 'jo@multienable.example')`,
        [tenantId, `multi-enable-${randomUUID()}`],
      );
      await client.query(`INSERT INTO tenant_auth_methods (tenant_id, method) VALUES ($1, 'email_password')`, [
        tenantId,
      ]);
    });

    const server = await buildTestServer();
    try {
      const putResponse = await server.inject({
        method: "PUT",
        url: "/tenant-auth/settings/methods",
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
        payload: { methods: ["email_password", "microsoft"] },
      });
      expect(putResponse.statusCode).toBe(200);

      const getResponse = await server.inject({
        method: "GET",
        url: "/tenant-auth/settings/methods",
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
      });
      expect(getResponse.statusCode).toBe(200);
      expect(getResponse.json().data.methods.sort()).toEqual(["email_password", "microsoft"]);
    } finally {
      await server.close();
    }
  });
});
