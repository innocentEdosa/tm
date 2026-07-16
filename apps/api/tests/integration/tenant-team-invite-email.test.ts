import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedUserWithRole, seedRole } from "../helpers/fixtures";
import { closeTestPool, withTenantTransaction, withTenantDb } from "../helpers/pg";
import { users } from "../../src/db/schema/users";
import { buildTenantCreationEmail } from "../../src/mail/email-templates";
import { __setMailSenderForTesting } from "../../src/tenant-auth/mailer";
import { ZeptoMailSender } from "../../src/mail/zeptomail-sender";
import { RecordingMailSender } from "../unit/fixtures/recording-mail-sender";

/**
 * Spec 019 (Transactional Email Template Redesign) User Story 2 — the invite email states the
 * inviting tenant's name and the new member's login email, with wording distinguishable from the
 * tenant-creation email even though both share the same branded shell.
 */
describe("POST /tenant-auth/team — invite email content (spec 019 User Story 2, FR-002, FR-003)", () => {
  afterEach(() => {
    __setMailSenderForTesting(new ZeptoMailSender());
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("sends exactly one branded invite email stating the tenant name and the member's login email", async () => {
    const recorder = new RecordingMailSender();
    __setMailSenderForTesting(recorder);

    const tenantId = randomUUID();
    const adminId = randomUUID();
    const { roleId } = await seedRole(tenantId, "Employee", []);
    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Invite Email Co', $2, 'Jo', 'jo@inviteemail.example')`,
        [tenantId, `invite-email-${randomUUID()}`],
      );
    });
    await withTenantDb(tenantId, async (db) => {
      await db.insert(users).values({
        id: adminId,
        tenantId,
        fullName: "Jo Admin",
        email: `jo-admin-${randomUUID()}@inviteemail.example`,
      });
    });
    await seedUserWithRole(tenantId, adminId, ["manage_team_members"]);

    const server = await buildTestServer();
    try {
      const memberEmail = `newmember-${randomUUID()}@inviteemail.example`;
      const response = await server.inject({
        method: "POST",
        url: "/tenant-auth/team",
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
        payload: { fullName: "New Member", email: memberEmail, roleId },
      });
      expect(response.statusCode).toBe(201);

      expect(recorder.received).toHaveLength(1);
      const [message] = recorder.received;
      expect(message.to).toBe(memberEmail);
      expect(message.text).toContain(memberEmail);
      expect(message.text).toContain("Invite Email Co");
      expect(message.html).toContain("Invite Email Co");

      // Distinguishable from the tenant-creation email even for the same tenant name (spec FR-003,
      // SC-005) — compared against the same builder US1 exercises, not a hardcoded string.
      const equivalentCreationEmail = buildTenantCreationEmail({
        loginEmail: memberEmail,
        tenantName: "Invite Email Co",
        oneTimePassword: "placeholder",
        otpValidityHours: 72,
      });
      expect(message.subject).not.toBe(equivalentCreationEmail.subject);
    } finally {
      await server.close();
    }
  });
});
