import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withSuperAdminTransaction } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { memberActionLog } from "../../src/db/schema/member-action-log";

describe("POST /tenants/:id/members writes a member_action_log row (spec FR-008)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("writes exactly one row with the correct tenant/member/super-admin ids and action", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    const { cookieHeader } = await seedSuperAdminSession();

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/members`,
        headers: { cookie: cookieHeader },
        payload: { fullName: "Logged Member", email: `logged-${randomUUID()}@example.com`, roleId },
      });
      expect(response.statusCode).toBe(201);
      const memberId = response.json().data.id as string;

      const rows = await withSuperAdminTransaction(async (client) => {
        const db = drizzle(client);
        return db.select().from(memberActionLog).where(eq(memberActionLog.memberId, memberId));
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        tenantId,
        memberId,
        action: "member_added",
      });
      expect(rows[0].superAdminId).toBeTruthy();
    } finally {
      await server.close();
    }
  });
});
