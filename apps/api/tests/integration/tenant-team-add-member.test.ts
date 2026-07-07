import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedUserWithRole, seedRole } from "../helpers/fixtures";
import { closeTestPool, withTenantTransaction, withTenantDb } from "../helpers/pg";
import { users } from "../../src/db/schema/users";

describe("POST /tenant-auth/team — add a team member (FR-018/FR-020)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("creates a distinct user scoped to the same tenant with a fresh OTP state", async () => {
    const tenantId = randomUUID();
    const adminId = randomUUID();
    const { roleId } = await seedRole(tenantId, "Employee", []);
    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Team Add Co', $2, 'Jo', 'jo@teamadd.example')`,
        [tenantId, `team-add-${randomUUID()}`],
      );
    });
    // A real `users` row for the caller — needed since the route now sets `invited_by` (FK →
    // users.id) on the member it creates (spec 012).
    await withTenantDb(tenantId, async (db) => {
      await db.insert(users).values({ id: adminId, tenantId, fullName: "Jo Admin", email: `jo-admin-${randomUUID()}@teamadd.example` });
    });
    await seedUserWithRole(tenantId, adminId, ["manage_team_members"]);

    const server = await buildTestServer();
    try {
      const email = `newmember-${randomUUID()}@teamadd.example`;
      const response = await server.inject({
        method: "POST",
        url: "/tenant-auth/team",
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
        payload: { fullName: "New Member", email, roleId },
      });
      expect(response.statusCode).toBe(201);

      const row = await withTenantTransaction(tenantId, async (client) => {
        const rows = await client.query<{ must_change_password: boolean; tenant_id: string }>(
          "SELECT must_change_password, tenant_id FROM users WHERE email = $1",
          [email],
        );
        return rows.rows[0];
      });
      expect(row.must_change_password).toBe(true);
      expect(row.tenant_id).toBe(tenantId);
    } finally {
      await server.close();
    }
  });

  it("rejects a duplicate email at the same tenant but allows it at a different tenant", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const adminA = randomUUID();
    const adminB = randomUUID();
    const { roleId: roleA } = await seedRole(tenantA, "Employee", []);
    const { roleId: roleB } = await seedRole(tenantB, "Employee", []);
    await withTenantTransaction(tenantA, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Dup Email A', $2, 'Jo', 'jo@dupa.example')`,
        [tenantA, `dup-a-${randomUUID()}`],
      );
    });
    await withTenantTransaction(tenantB, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Dup Email B', $2, 'Jo', 'jo@dupb.example')`,
        [tenantB, `dup-b-${randomUUID()}`],
      );
    });
    // Real `users` rows for both callers — needed since the route now sets `invited_by`.
    await withTenantDb(tenantA, async (db) => {
      await db.insert(users).values({ id: adminA, tenantId: tenantA, fullName: "Jo Admin A", email: `jo-a-${randomUUID()}@dupa.example` });
    });
    await withTenantDb(tenantB, async (db) => {
      await db.insert(users).values({ id: adminB, tenantId: tenantB, fullName: "Jo Admin B", email: `jo-b-${randomUUID()}@dupb.example` });
    });
    await seedUserWithRole(tenantA, adminA, ["manage_team_members"]);
    await seedUserWithRole(tenantB, adminB, ["manage_team_members"]);

    const sharedEmail = `shared-${randomUUID()}@dup-email.example`;
    const server = await buildTestServer();
    try {
      const first = await server.inject({
        method: "POST",
        url: "/tenant-auth/team",
        headers: { "x-test-user-id": adminA, "x-test-tenant-id": tenantA },
        payload: { fullName: "Person One", email: sharedEmail, roleId: roleA },
      });
      expect(first.statusCode).toBe(201);

      const duplicateAtSameTenant = await server.inject({
        method: "POST",
        url: "/tenant-auth/team",
        headers: { "x-test-user-id": adminA, "x-test-tenant-id": tenantA },
        payload: { fullName: "Person One Again", email: sharedEmail, roleId: roleA },
      });
      expect(duplicateAtSameTenant.statusCode).toBe(409);

      const sameEmailAtDifferentTenant = await server.inject({
        method: "POST",
        url: "/tenant-auth/team",
        headers: { "x-test-user-id": adminB, "x-test-tenant-id": tenantB },
        payload: { fullName: "Person One", email: sharedEmail, roleId: roleB },
      });
      expect(sameEmailAtDifferentTenant.statusCode).toBe(201);
    } finally {
      await server.close();
    }
  });
});
