/**
 * Shared HTML/text template shell for every transactional email TM sends (research.md §1–§5,
 * data-model.md, contracts/email-template-builders.md). Nothing outside this file knows the visual
 * design tokens (design-system/tm/MASTER.md, adapted to email-safe HTML in research.md §3) or the
 * table-based/inline-style layout rules email clients require (research.md §4) — `mailer.ts` only
 * ever sees the finished `{ subject, text, html }` a builder function below returns.
 */

const COLOR_PRIMARY = "#0F172A";
const COLOR_CTA = "#0369A1";
const COLOR_BACKGROUND = "#F8FAFC";
const COLOR_TEXT = "#020617";
const COLOR_MUTED = "#334155";
const FONT_STACK =
  "'Plus Jakarta Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export interface EmailTemplateResult {
  subject: string;
  text: string;
  html: string;
}

interface EmailBlock {
  html: string;
  text: string;
}

/** The only place user-/tenant-supplied text is made HTML-safe before interpolation (spec FR-007). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paragraph(text: string): EmailBlock {
  return {
    html: `<p style="margin:0 0 16px 0;font-size:15px;line-height:24px;color:${COLOR_TEXT};">${text}</p>`,
    text: `${text}\n`,
  };
}

/** A single "Label: value" line — the labeled-fact treatment spec FR-001/FR-002/FR-006 require for
 * the login email, tenant name, etc., never folded silently into prose. `value` is escaped for HTML
 * here; callers pass the raw value and never need to escape it themselves. */
function factRow(label: string, rawValue: string): EmailBlock {
  const safeLabel = escapeHtml(label);
  const safeValue = escapeHtml(rawValue);
  return {
    html: `<p style="margin:0 0 8px 0;font-size:15px;line-height:22px;"><strong style="color:${COLOR_PRIMARY};">${safeLabel}:</strong> <span style="color:${COLOR_TEXT};">${safeValue}</span></p>`,
    text: `${label}: ${rawValue}`,
  };
}

/** The highlighted, hard-to-miss OTP display (spec SC-003 — findable within 5 seconds). */
function otpBlock(otp: string): EmailBlock {
  const safeOtp = escapeHtml(otp);
  return {
    html: `<div style="margin:8px 0 24px 0;padding:16px 24px;background-color:${COLOR_BACKGROUND};border:1px solid ${COLOR_CTA};border-radius:12px;text-align:center;">
      <span style="display:block;font-size:12px;font-weight:600;color:${COLOR_MUTED};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Your one-time password</span>
      <span style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:26px;font-weight:700;letter-spacing:0.3em;color:${COLOR_CTA};">${safeOtp}</span>
    </div>`,
    text: `Your one-time password: ${otp}`,
  };
}

/** The highlighted reset-link action — a button in HTML (spec FR-004), a plain URL in text and
 * repeated under the button in HTML too, since a real `<button>`/JS click handler isn't reliable in
 * email and the raw URL must stay copy-pasteable (research.md §4). */
function ctaButton(url: string, label: string): EmailBlock {
  const safeUrl = escapeHtml(url);
  const safeLabel = escapeHtml(label);
  return {
    html: `<div style="margin:8px 0 16px 0;text-align:center;">
      <a href="${safeUrl}" style="display:inline-block;background-color:${COLOR_CTA};color:#ffffff;font-weight:600;font-size:15px;padding:12px 28px;border-radius:8px;text-decoration:none;">${safeLabel}</a>
    </div>
    <p style="margin:0 0 16px 0;font-size:13px;line-height:20px;color:${COLOR_MUTED};word-break:break-all;">${safeUrl}</p>`,
    text: `${label}: ${url}`,
  };
}

/** The one shared, brand-consistent wrapper every email variant renders through (research.md §3–§4):
 * a centered, 600px-max, table-based card with a wordmark header, an event-specific heading and
 * body blocks, and a muted footer note. No `<style>` block is relied on — every rule is inline. */
function renderShell(heading: string, blocks: EmailBlock[], footerNote: string): { html: string; text: string } {
  const bodyHtml = blocks.map((block) => block.html).join("\n");
  const bodyText = blocks.map((block) => block.text).join("\n\n");
  const safeHeading = escapeHtml(heading);

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body style="margin:0;padding:0;background-color:${COLOR_BACKGROUND};font-family:${FONT_STACK};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLOR_BACKGROUND};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;">
            <tr>
              <td style="padding:32px 40px 0 40px;">
                <span style="font-size:20px;font-weight:700;color:${COLOR_PRIMARY};letter-spacing:-0.02em;font-family:${FONT_STACK};">TM</span>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 40px 0 40px;">
                <h1 style="margin:0;font-size:22px;line-height:28px;color:${COLOR_PRIMARY};font-weight:600;font-family:${FONT_STACK};">${safeHeading}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 40px 0 40px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:8px 40px 32px 40px;border-top:1px solid ${COLOR_BACKGROUND};">
                <p style="margin:16px 0 0 0;font-size:13px;line-height:20px;color:${COLOR_MUTED};">${footerNote}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `${heading}\n\n${bodyText}\n\n${footerNote}`;

  return { html, text };
}

export interface TenantCreationEmailInput {
  loginEmail: string;
  tenantName: string;
  oneTimePassword: string;
  otpValidityHours: number;
}

export function buildTenantCreationEmail(input: TenantCreationEmailInput): EmailTemplateResult {
  const heading = "Welcome to TM";
  const blocks: EmailBlock[] = [
    paragraph(
      `Your organization, <strong>${escapeHtml(input.tenantName)}</strong>, has been set up on TM. Use the credentials below to sign in for the first time.`,
    ),
    factRow("Organization", input.tenantName),
    factRow("Login email", input.loginEmail),
    otpBlock(input.oneTimePassword),
    paragraph("You'll be asked to set your own password immediately after signing in."),
  ];
  const footerNote = `This one-time password expires in ${input.otpValidityHours} hours. If you weren't expecting this email, you can safely ignore it.`;
  const { html, text } = renderShell(heading, blocks, footerNote);

  return { subject: "Welcome to TM — set up your account", text, html };
}

export interface MemberInviteEmailInput {
  loginEmail: string;
  tenantName: string;
  oneTimePassword: string;
  otpValidityHours: number;
}

export function buildMemberInviteEmail(input: MemberInviteEmailInput): EmailTemplateResult {
  const heading = `You're invited to join ${input.tenantName}`;
  const blocks: EmailBlock[] = [
    paragraph(
      `You've been added as a team member on TM for <strong>${escapeHtml(input.tenantName)}</strong>. Use the credentials below to sign in for the first time.`,
    ),
    factRow("Organization", input.tenantName),
    factRow("Login email", input.loginEmail),
    otpBlock(input.oneTimePassword),
    paragraph("You'll be asked to set your own password immediately after signing in."),
  ];
  const footerNote = `This one-time password expires in ${input.otpValidityHours} hours. If you weren't expecting this email, you can safely ignore it.`;
  const { html, text } = renderShell(heading, blocks, footerNote);

  return { subject: `You've been invited to join ${input.tenantName} on TM`, text, html };
}

export interface PasswordResetEmailInput {
  resetLink: string;
  linkValidityHours: number;
}

export function buildPasswordResetEmail(input: PasswordResetEmailInput): EmailTemplateResult {
  const heading = "Reset your password";
  const blocks: EmailBlock[] = [
    paragraph(
      "We received a request to reset the password on your TM account. Click the button below to choose a new password.",
    ),
    ctaButton(input.resetLink, "Reset password"),
  ];
  const hourWord = input.linkValidityHours === 1 ? "hour" : "hours";
  const footerNote = `This link expires in ${input.linkValidityHours} ${hourWord} and is single-use — it stops working once you've used it. If you didn't request a password reset, you can safely ignore this email — your password will not be changed.`;
  const { html, text } = renderShell(heading, blocks, footerNote);

  return { subject: "Reset your TM password", text, html };
}

export interface CourseUpdateAvailableEmailInput {
  courseTitle: string;
  manageUrl: string;
}

/** Course Marketplace Updates (spec 032) — sent to every `course.manage` holder on a tenant when the
 * platform course they cloned has been edited since (research.md §8). */
export function buildCourseUpdateAvailableEmail(input: CourseUpdateAvailableEmailInput): EmailTemplateResult {
  const heading = `An update is available for ${input.courseTitle}`;
  const blocks: EmailBlock[] = [
    paragraph(
      `<strong>${escapeHtml(input.courseTitle)}</strong> has been updated since you added it to your organization's course catalog. Review the update and choose to apply it or keep your current version.`,
    ),
    ctaButton(input.manageUrl, "Review update"),
  ];
  const footerNote = "Your course stays exactly as it is until you choose to apply the update — nothing changes automatically.";
  const { html, text } = renderShell(heading, blocks, footerNote);

  return { subject: `Update available: ${input.courseTitle}`, text, html };
}

export interface TnaAssignmentEmailInput {
  exerciseTitle: string;
  endDate: string;
  respondUrl: string;
}

/** Training Needs Analysis — sent to each participant once, at the moment an exercise moves from
 * `draft` to `active` and their `tna_assignments` row is created (tna-assignment-mailer.ts). This is
 * the only notification this feature sends — no deadline-reminder cron exists in this codebase, so a
 * participant otherwise has to already hold `tna.manage`/`tna.view` (to see the Strategy nav entry)
 * or be handed a direct link to discover a role-/user-targeted assignment. */
export function buildTnaAssignmentEmail(input: TnaAssignmentEmailInput): EmailTemplateResult {
  const heading = `You have a Training Needs Analysis to complete: ${input.exerciseTitle}`;
  const blocks: EmailBlock[] = [
    paragraph(
      `Your organization has asked you to complete <strong>${escapeHtml(input.exerciseTitle)}</strong>, due by <strong>${escapeHtml(input.endDate)}</strong>.`,
    ),
    ctaButton(input.respondUrl, "Complete Training Needs Analysis"),
  ];
  const footerNote = "You can save your progress and come back before the deadline.";
  const { html, text } = renderShell(heading, blocks, footerNote);

  return { subject: `Action needed: ${input.exerciseTitle}`, text, html };
}
