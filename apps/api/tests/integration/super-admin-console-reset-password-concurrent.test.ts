import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { users } from "../../src/db/schema/users";
import { userRoles } from "../../src/db/schema/roles";
import { verifyPassword } from "../../src/platform-auth/password";

describe("Two concurrent password resets for the same member leave a single, consistent final state (spec Edge Cases)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("both requests succeed and the final password hash matches exactly one of the two generated passwords", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    const memberId = await withTenantDb(tenantId, async (db) => {
      const [member] = await db
        .insert(users)
        .values({ tenantId, fullName: "Concurrent Target", email: `concurrent-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId, userId: member.id, roleId });
      return member.id;
    });

    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const [responseA, responseB] = await Promise.all([
        server.inject({
          method: "POST",
          url: `/tenants/${tenantId}/members/${memberId}/reset-password`,
          headers: { cookie: cookieHeader },
        }),
        server.inject({
          method: "POST",
          url: `/tenants/${tenantId}/members/${memberId}/reset-password`,
          headers: { cookie: cookieHeader },
        }),
      ]);

      expect(responseA.statusCode).toBe(200);
      expect(responseB.statusCode).toBe(200);
      const passwordA = responseA.json().data.generatedPassword as string;
      const passwordB = responseB.json().data.generatedPassword as string;
      expect(passwordA).not.toBe(passwordB);

      const [row] = await withTenantDb(tenantId, async (db) =>
        db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, memberId)),
      );

      const matchesA = await verifyPassword(passwordA, row.passwordHash!);
      const matchesB = await verifyPassword(passwordB, row.passwordHash!);
      // Exactly one of the two generated passwords is the final, consistent state — never both
      // (which would mean the hash is ambiguous) and never neither (which would mean a lost update).
      expect([matchesA, matchesB].filter(Boolean)).toHaveLength(1);
    } finally {
      await server.close();
    }
  });
});
