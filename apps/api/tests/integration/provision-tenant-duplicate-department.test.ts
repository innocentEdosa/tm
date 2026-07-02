import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { seedSuperAdminUser } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe("POST /provisioning/tenants — duplicate department name rolls back the whole attempt (US3)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns 409 and leaves no tenants/departments/users/user_roles row from the attempt", async () => {
    const server = await buildTestServer();
    const superAdminUserId = randomUUID();
    await seedSuperAdminUser(superAdminUserId);
    const subdomain = `acme-${randomUUID()}`;

    const response = await server.inject({
      method: "POST",
      url: "/provisioning/tenants",
      headers: { "x-test-user-id": superAdminUserId, "x-test-tenant-id": randomUUID() },
      payload: {
        company: {
          name: "Acme Corp",
          subdomain,
          primaryContact: { name: "Jordan Lee", email: "jordan.lee@acme.example" },
        },
        departments: [{ name: "Engineering" }, { name: "Engineering" }],
        admin: { fullName: "Priya Shah", email: `priya.shah+${randomUUID()}@acme.example` },
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().success).toBe(false);

    // FR-013: the whole attempt rolled back — the tenant itself was never left behind either,
    // even though the tenant insert (and admin/role) succeeded before the department step failed.
    // A fresh attempt with the same subdomain must succeed, proving no orphan tenant survived.
    const retry = await server.inject({
      method: "POST",
      url: "/provisioning/tenants",
      headers: { "x-test-user-id": superAdminUserId, "x-test-tenant-id": randomUUID() },
      payload: {
        company: {
          name: "Acme Corp",
          subdomain,
          primaryContact: { name: "Jordan Lee", email: "jordan.lee@acme.example" },
        },
        admin: { fullName: "Priya Shah", email: `priya.shah+${randomUUID()}@acme.example` },
      },
    });
    expect(retry.statusCode).toBe(201);

    const tenantId: string = retry.json().data.tenant.id;
    const userCount = await withTenantTransaction(tenantId, async (client) => {
      const result = await client.query("SELECT id FROM users WHERE tenant_id = $1", [tenantId]);
      return result.rows.length;
    });
    expect(userCount).toBe(1);

    await server.close();
  });
});
