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

describe("PATCH /tenants/:id/members/:memberId — action log (spec FR-010)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("writes exactly one member_action_log row with action: member_edited", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    const memberId = await withTenantDb(tenantId, async (db) => {
      const [member] = await db
        .insert(users)
        .values({ tenantId, fullName: "Log Person", email: `log-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId, userId: member.id, roleId });
      return member.id;
    });

    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenants/${tenantId}/members/${memberId}`,
        headers: { cookie: cookieHeader },
        payload: { fullName: "Renamed Log Person" },
      });
      expect(response.statusCode).toBe(200);

      const rows = await withSuperAdminTransaction(async (client) => {
        const db = drizzle(client);
        return db.select().from(memberActionLog).where(eq(memberActionLog.memberId, memberId));
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ tenantId, memberId, action: "member_edited" });
    } finally {
      await server.close();
    }
  });
});
