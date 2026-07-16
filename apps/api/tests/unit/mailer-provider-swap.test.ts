import { describe, expect, it } from "vitest";
import {
  sendTenantCreationEmail,
  sendMemberInviteEmail,
  sendPasswordResetEmail,
  __setMailSenderForTesting,
} from "../../src/tenant-auth/mailer";
import { RecordingMailSender } from "./fixtures/recording-mail-sender";

/**
 * Proves the abstraction itself (Email API Mailer spec, User Story 2; SC-003): swapping the active
 * `MailSender` for a completely different implementation requires zero changes to any public
 * `mailer.ts` function, and — by construction, since none of them import anything beyond
 * `mailer.ts` — zero changes to `provision-tenant.ts`, `tenant-team-routes.ts`, or
 * `tenant-auth-routes.ts` either.
 */
describe("mailer.ts — swapping the active MailSender needs no call-site changes (US2)", () => {
  it("a brand-new MailSender implementation receives sends via the unchanged public API", async () => {
    const recorder = new RecordingMailSender();
    __setMailSenderForTesting(recorder);

    await sendTenantCreationEmail("new-admin@example.com", "111222", "Acme Co");
    await sendMemberInviteEmail("new-member@example.com", "333444", "Acme Co");
    await sendPasswordResetEmail("existing-user@example.com", "https://acme.tm.com/reset?token=xyz");

    expect(recorder.received).toHaveLength(3);
    expect(recorder.received[0]).toMatchObject({ to: "new-admin@example.com" });
    expect(recorder.received[0].text).toContain("111222");
    expect(recorder.received[1]).toMatchObject({ to: "new-member@example.com" });
    expect(recorder.received[1].text).toContain("333444");
    expect(recorder.received[2]).toMatchObject({ to: "existing-user@example.com" });
    expect(recorder.received[2].text).toContain("https://acme.tm.com/reset?token=xyz");
  });
});
