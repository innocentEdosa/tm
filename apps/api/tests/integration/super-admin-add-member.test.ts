import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { users } from "../../src/db/schema/users";
import { __setMailSenderForTesting } from "../../src/tenant-auth/mailer";
import { ZeptoMailSender } from "../../src/mail/zeptomail-sender";
import { RecordingMailSender } from "../unit/fixtures/recording-mail-sender";

describe("POST /tenants/:id/members — success (spec FR-001/FR-002/FR-005/FR-006/FR-007)", () => {
  afterEach(() => {
    __setMailSenderForTesting(new ZeptoMailSender());
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("creates the member, forces a password change, leaves invited_by null, and sends one invite email", async () => {
    const recorder = new RecordingMailSender();
    __setMailSenderForTesting(recorder);

    const tenantId = randomUUID();
    await seedTenant(tenantId, `Add Member Success ${tenantId}`);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    const { cookieHeader } = await seedSuperAdminSession();
    const memberEmail = `new-member-${randomUUID()}@example.com`;

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/members`,
        headers: { cookie: cookieHeader },
        payload: { fullName: "New Member", email: memberEmail, roleId },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.email).toBe(memberEmail);

      const [row] = await withTenantDb(tenantId, async (db) =>
        db.select().from(users).where(eq(users.id, body.data.id)),
      );
      expect(row.mustChangePassword).toBe(true);
      expect(row.invitedBy).toBeNull();
      expect(row.passwordHash).toBeTruthy();

      expect(recorder.received).toHaveLength(1);
      expect(recorder.received[0].to).toBe(memberEmail);
    } finally {
      await server.close();
    }
  });
});
