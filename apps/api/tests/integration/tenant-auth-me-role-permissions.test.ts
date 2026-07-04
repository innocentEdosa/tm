import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { hashPassword } from "../../src/platform-auth/password";

describe("GET /tenant-auth/me returns roleName and permissions (Role-Based Dashboard Shell)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns the user's role name and effective permissions", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const subdomain = `me-role-${randomUUID()}`;
    const email = `jo+${randomUUID()}@me-role.example`;
    const password = "a real password";

    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Me Role Co', $2, 'Jo', 'jo@me-role.example')`,
        [tenantId, subdomain],
      );
      await client.query(
        `INSERT INTO users (id, tenant_id, full_name, email, password_hash, must_change_password)
         VALUES ($1, $2, 'Jo Admin', $3, $4, false)`,
        [userId, tenantId, email, await hashPassword(password)],
      );
    });
    await seedUserWithRole(tenantId, userId, ["manage_team_members", "manage_authentication_settings"]);

    const server = await buildTestServer();
    try {
      const loginResponse = await server.inject({
        method: "POST",
        url: `/tenant-auth/login?subdomain=${subdomain}`,
        payload: { email, password },
      });
      const cookie = (loginResponse.headers["set-cookie"] as string).split(";")[0];

      const meResponse = await server.inject({
        method: "GET",
        url: `/tenant-auth/me?subdomain=${subdomain}`,
        headers: { cookie },
      });
      expect(meResponse.statusCode).toBe(200);
      const { data } = meResponse.json();
      expect(data.roleName).toMatch(/^Test Role /);
      expect(data.permissions.sort()).toEqual(
        ["manage_authentication_settings", "manage_team_members"].sort(),
      );
    } finally {
      await server.close();
    }
  });

  it("returns roleName: null and permissions: [] for a user with zero roles", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const subdomain = `me-no-role-${randomUUID()}`;
    const email = `jo+${randomUUID()}@me-no-role.example`;
    const password = "a real password";

    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Me No Role Co', $2, 'Jo', 'jo@me-no-role.example')`,
        [tenantId, subdomain],
      );
      await client.query(
        `INSERT INTO users (id, tenant_id, full_name, email, password_hash, must_change_password)
         VALUES ($1, $2, 'Jo Roleless', $3, $4, false)`,
        [userId, tenantId, email, await hashPassword(password)],
      );
    });

    const server = await buildTestServer();
    try {
      const loginResponse = await server.inject({
        method: "POST",
        url: `/tenant-auth/login?subdomain=${subdomain}`,
        payload: { email, password },
      });
      const cookie = (loginResponse.headers["set-cookie"] as string).split(";")[0];

      const meResponse = await server.inject({
        method: "GET",
        url: `/tenant-auth/me?subdomain=${subdomain}`,
        headers: { cookie },
      });
      expect(meResponse.statusCode).toBe(200);
      const { data } = meResponse.json();
      expect(data.roleName).toBeNull();
      expect(data.permissions).toEqual([]);
    } finally {
      await server.close();
    }
  });
});
