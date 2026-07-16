import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { users } from "../../src/db/schema/users";
import { userRoles } from "../../src/db/schema/roles";
import { verifyPassword } from "../../src/platform-auth/password";
import { __setMailSenderForTesting } from "../../src/tenant-auth/mailer";
import { ZeptoMailSender } from "../../src/mail/zeptomail-sender";
import { RecordingMailSender } from "../unit/fixtures/recording-mail-sender";

describe("POST /tenants/:id/members/:memberId/reset-password (spec FR-008/FR-009)", () => {
  afterEach(() => {
    __setMailSenderForTesting(new ZeptoMailSender());
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("returns a generated password, updates the member's password hash to match it, and sends no email", async () => {
    const recorder = new RecordingMailSender();
    __setMailSenderForTesting(recorder);

    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    const memberId = await withTenantDb(tenantId, async (db) => {
      const [member] = await db
        .insert(users)
        .values({ tenantId, fullName: "Locked Out", email: `locked-${randomUUID()}@example.com` })
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
      const generatedPassword = response.json().data.generatedPassword as string;
      expect(generatedPassword).toBeTruthy();

      const [row] = await withTenantDb(tenantId, async (db) =>
        db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, memberId)),
      );
      expect(await verifyPassword(generatedPassword, row.passwordHash!)).toBe(true);

      expect(recorder.received).toHaveLength(0);
    } finally {
      await server.close();
    }
  });
});
