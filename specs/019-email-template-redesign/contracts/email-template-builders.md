# Contract: Email template builders (`apps/api/src/mail/email-templates.ts`)

New module (data-model.md `EmailTemplateResult`, research.md §2–§5). Owns every piece of copy and
markup for the three transactional emails, plus the shared shell they're rendered inside, so
`mailer.ts` and its call sites never construct subject/text/HTML strings themselves.

```typescript
export interface EmailTemplateResult {
  subject: string;
  text: string;
  html: string;
}

export function buildTenantCreationEmail(input: {
  loginEmail: string;
  tenantName: string;
  oneTimePassword: string;
  otpValidityHours: number;
}): EmailTemplateResult;

export function buildMemberInviteEmail(input: {
  loginEmail: string;
  tenantName: string;
  oneTimePassword: string;
  otpValidityHours: number;
}): EmailTemplateResult;

export function buildPasswordResetEmail(input: {
  resetLink: string;
  linkValidityHours: number;
}): EmailTemplateResult;
```

## Rules an implementation MUST follow

1. `buildTenantCreationEmail` and `buildMemberInviteEmail` MUST both render `loginEmail`,
   `tenantName`, `oneTimePassword`, and `otpValidityHours` as distinct, labeled values in both `text`
   and `html` (spec FR-001, FR-002, FR-006) — never folded silently into prose that omits one of them.
2. `buildTenantCreationEmail` and `buildMemberInviteEmail` MUST produce different `subject` and body
   wording appropriate to their event (new-account welcome vs. team invite) even though both call the
   same internal shell-rendering helper (spec FR-003, SC-005).
3. `buildPasswordResetEmail` MUST render `resetLink` as a distinctly highlighted action in `html`
   (button-styled `<a>`, per research.md §3) and as a plain URL in `text`, plus `linkValidityHours`,
   a single-use statement, and an ignore-if-not-you note (spec FR-004).
4. Every builder's `html` output MUST be a complete, self-contained fragment following research.md
   §3–§4 (table layout, inline styles, `max-width: 600px`, no external asset dependency for
   legibility, TM's locked palette/typography from `design-system/tm/MASTER.md`).
5. Every builder's `text` output MUST contain every fact its `html` output does (spec FR-005) — no
   field appears only in one representation.
6. Any input value that is not already known to be system-controlled plain text (i.e. `tenantName`,
   sourced from a tenant-supplied company name) MUST be passed through a local `escapeHtml()` helper
   before being interpolated into `html`. `loginEmail`, `oneTimePassword`, and `resetLink` are
   system-generated/validated values (an email address, a generated code, a generated URL) and do not
   require the same treatment, but escaping them too is not incorrect — implementers MAY escape all
   interpolated values uniformly for simplicity as long as rule 1–3's content still renders correctly.
7. None of these functions perform I/O (no network call, no DB read) — every input is a plain value
   the caller (`mailer.ts` or, transitively, a route handler) already resolved. This keeps the module
   trivially unit-testable without the `RecordingMailSender` fixture or a database.

## Consumer contract (`mailer.ts`)

Each `mailer.ts` export (see `mail-transport-interface.md`) calls exactly one builder and passes its
`EmailTemplateResult` straight into the `MailMessage` given to `sendMail()`:

```typescript
export async function sendTenantCreationEmail(to: string, otp: string, tenantName: string): Promise<void> {
  const { subject, text, html } = buildTenantCreationEmail({
    loginEmail: to,
    tenantName,
    oneTimePassword: otp,
    otpValidityHours: OTP_VALIDITY_HOURS, // 72 — research.md §9
  });
  await sendMail({ to, subject, text, html });
}
```

(Illustrative — exact constant naming/placement is an implementation detail left to the tasks phase,
not fixed by this contract.)
