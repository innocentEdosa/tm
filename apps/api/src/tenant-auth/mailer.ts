import {
  buildTenantCreationEmail,
  buildMemberInviteEmail,
  buildPasswordResetEmail,
} from "../mail/email-templates";
import { sendMail, __setMailSenderForTesting } from "../mail/send-mail";

/** Matches OTP_VALIDITY_MS in ./otp.ts (72 hours) — restated here as the copy value the templates
 * display, kept in sync by research.md §9's cross-check rather than importing the raw millisecond
 * constant into a hours-denominated field. */
const OTP_VALIDITY_HOURS = 72;
/** Matches RESET_TOKEN_VALIDITY_MS in ./tenant-auth-routes.ts (1 hour) — research.md §8. */
const RESET_LINK_VALIDITY_HOURS = 1;

// Re-exported for existing call sites/tests that import the test seam from this file (spec 032
// research.md §8 moved the implementation to ../mail/send-mail.ts; this file's public surface is
// otherwise unchanged).
export { __setMailSenderForTesting };

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
