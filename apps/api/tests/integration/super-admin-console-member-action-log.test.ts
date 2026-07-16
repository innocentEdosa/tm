import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb, withSuperAdminTransaction } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { users } from "../../src/db/schema/users";
import { userRoles } from "../../src/db/schema/roles";
import { memberActionLog } from "../../src/db/schema/member-action-log";

describe("Password reset writes a member_action_log row (spec FR-011)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("writes exactly one row with the correct tenant/member/super-admin ids and action", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    const memberId = await withTenantDb(tenantId, async (db) => {
      const [member] = await db
        .insert(users)
        .values({ tenantId, fullName: "Logged Member", email: `logged-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId, userId: member.id, roleId });
      return member.id;
    });

    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/members/${memberId}/reset-password`,
        headers: { cookie: cookieHeader },
      });
      expect(response.statusCode).toBe(200);

      const rows = await withSuperAdminTransaction(async (client) => {
        const db = drizzle(client);
        return db.select().from(memberActionLog).where(eq(memberActionLog.memberId, memberId));
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        tenantId,
        memberId,
        action: "password_reset",
      });
      expect(rows[0].superAdminId).toBeTruthy();
    } finally {
      await server.close();
    }
  });
});
