import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb, withTenantTransaction } from "../helpers/pg";
import { seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { users } from "../../src/db/schema/users";
import { userRoles } from "../../src/db/schema/roles";

describe("Password reset via the console does not force a change at next login (spec Clarifications)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("logs in directly with the generated password, with mustChangePassword staying false", async () => {
    const tenantId = randomUUID();
    const subdomain = `no-forced-${randomUUID()}`;
    const email = `jo+${randomUUID()}@no-forced.example`;

    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'No Forced Change Co', $2, 'Jo', 'jo@no-forced.example')`,
        [tenantId, subdomain],
      );
    });
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    const memberId = await withTenantDb(tenantId, async (db) => {
      const [member] = await db
        .insert(users)
        .values({ tenantId, fullName: "Jo Member", email })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId, userId: member.id, roleId });
      return member.id;
    });

    const { cookieHeader: superAdminCookie } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const resetResponse = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/members/${memberId}/reset-password`,
        headers: { cookie: superAdminCookie },
      });
      expect(resetResponse.statusCode).toBe(200);
      const generatedPassword = resetResponse.json().data.generatedPassword as string;

      const [row] = await withTenantDb(tenantId, async (db) =>
        db.select({ mustChangePassword: users.mustChangePassword }).from(users).where(eq(users.id, memberId)),
      );
      expect(row.mustChangePassword).toBe(false);

      const loginResponse = await server.inject({
        method: "POST",
        url: `/tenant-auth/login?subdomain=${subdomain}`,
        payload: { email, password: generatedPassword },
      });
      expect(loginResponse.statusCode).toBe(200);
      expect(loginResponse.json().data.mustChangePassword).toBe(false);
    } finally {
      await server.close();
    }
  });
});
