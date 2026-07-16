import type { MailMessage, MailSender } from "../mail/mail-sender";
import { ZeptoMailSender } from "../mail/zeptomail-sender";
import {
  buildTenantCreationEmail,
  buildMemberInviteEmail,
  buildPasswordResetEmail,
} from "../mail/email-templates";

const SEND_TIMEOUT_MS = 3000;
/** Matches OTP_VALIDITY_MS in ./otp.ts (72 hours) — restated here as the copy value the templates
 * display, kept in sync by research.md §9's cross-check rather than importing the raw millisecond
 * constant into a hours-denominated field. */
const OTP_VALIDITY_HOURS = 72;
/** Matches RESET_TOKEN_VALIDITY_MS in ./tenant-auth-routes.ts (1 hour) — research.md §8. */
const RESET_LINK_VALIDITY_HOURS = 1;

let activeSender: MailSender = new ZeptoMailSender();

/** Test-only seam — never called outside tests. Mirrors `server.ts`'s `registerAuthStub` precedent:
 * lets tests install a fake `MailSender` to prove the wrapper guarantees below hold independent of
 * which provider is active (Email API Mailer spec, User Story 2). */
export function __setMailSenderForTesting(sender: MailSender): void {
  activeSender = sender;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Mail send timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * The single place the non-blocking-failure, skip-when-unconfigured, and bounded-timeout guarantees
 * live (research.md §3, §4) — enforced once, around whichever `MailSender` is active, rather than
 * duplicated inside each adapter. Callers (the two exported functions below) MUST NOT let a
 * rejection here fail the operation that triggered it (spec Edge Cases; FR-004) — the account is
 * created/reset-token issued regardless; a fresh email can always be re-triggered.
 */
async function sendMail(message: MailMessage): Promise<void> {
  if (!activeSender.isConfigured()) {
    console.warn(`Mail provider not configured — skipping email to ${message.to}`);
    return;
  }
  try {
    await withTimeout(activeSender.send(message), SEND_TIMEOUT_MS);
  } catch (err) {
    console.error(`Failed to send email to ${message.to}:`, err);
  }
}

/** Sent once, right after a new tenant is provisioned, to that tenant's admin (spec 019 User Story
 * 1) — distinct copy from sendMemberInviteEmail below even though both render through the same
 * template shell (research.md §5). */
export async function sendTenantCreationEmail(to: string, otp: string, tenantName: string): Promise<void> {
  const { subject, text, html } = buildTenantCreationEmail({
    loginEmail: to,
    tenantName,
    oneTimePassword: otp,
    otpValidityHours: OTP_VALIDITY_HOURS,
  });
  await sendMail({ to, subject, text, html });
}

/** Sent when an existing tenant admin invites a new team member (spec 019 User Story 2). */
export async function sendMemberInviteEmail(to: string, otp: string, tenantName: string): Promise<void> {
  const { subject, text, html } = buildMemberInviteEmail({
    loginEmail: to,
    tenantName,
    oneTimePassword: otp,
    otpValidityHours: OTP_VALIDITY_HOURS,
  });
  await sendMail({ to, subject, text, html });
}

export async function sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
  const { subject, text, html } = buildPasswordResetEmail({
    resetLink,
    linkValidityHours: RESET_LINK_VALIDITY_HOURS,
  });
  await sendMail({ to, subject, text, html });
}
