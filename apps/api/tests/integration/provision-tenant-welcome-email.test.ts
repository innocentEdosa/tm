import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getTestPool, closeTestPool } from "../helpers/pg";
import { provisionTenant } from "../../src/provisioning/provision-tenant";
import { __setMailSenderForTesting } from "../../src/tenant-auth/mailer";
import { ZeptoMailSender } from "../../src/mail/zeptomail-sender";
import { RecordingMailSender } from "../unit/fixtures/recording-mail-sender";

/**
 * Closes the exact gap spec 019 (Transactional Email Template Redesign) User Story 1 exists to fix:
 * the tenant-creation welcome email now states the admin's own login email explicitly, not just the
 * OTP, alongside the tenant name.
 */
describe("provisionTenant — welcome email content (spec 019 User Story 1, FR-001, FR-006)", () => {
  afterEach(() => {
    // Restores the real adapter so later suites in the same run aren't left pointed at the recorder.
    __setMailSenderForTesting(new ZeptoMailSender());
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("sends exactly one branded welcome email stating the admin's login email and the tenant name", async () => {
    const recorder = new RecordingMailSender();
    __setMailSenderForTesting(recorder);

    const subdomain = `welcome-email-${randomUUID()}`;
    const adminEmail = `jo+${randomUUID()}@welcomeemail.example`;
    const result = await provisionTenant(getTestPool(), {
      company: {
        name: "Welcome Email Co",
        subdomain,
        primaryContact: { name: "Jo", email: "jo@welcomeemail.example" },
      },
      admin: { fullName: "Jo Admin", email: adminEmail },
    });

    expect(recorder.received).toHaveLength(1);
    const [message] = recorder.received;
    expect(message.to).toBe(adminEmail);
    expect(message.text).toContain(adminEmail);
    expect(message.html).toContain(adminEmail);
    expect(message.text).toContain("Welcome Email Co");
    expect(message.html).toContain("Welcome Email Co");
    expect(result.admin.email).toBe(adminEmail);
  });
});
