# Contract: Mail transport (`MailMessage`/`MailSender`) and `mailer.ts` consumer surface

Supersedes, for this feature's scope, specs/016-email-api-mailer/contracts/mail-sender-interface.md's
`MailMessage` shape and `mailer.ts` export list. The `MailSender` interface itself (`isConfigured()` /
`send()`) and every rule governing it (spec 016) are unchanged — only the payload it carries and the
names/count of `mailer.ts`'s exports change.

## `MailMessage` (`apps/api/src/mail/mail-sender.ts`)

```typescript
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string; // NEW in this feature
}

export interface MailSender {
  isConfigured(): boolean;
  send(message: MailMessage): Promise<void>;
}
```

Rules 1–5 from specs/016's contract still apply verbatim (isConfigured MUST NOT network-call; send()
MUST attempt exactly one delivery, MAY throw, MUST NOT swallow its own failures; timeout is
`mailer.ts`'s responsibility, not the adapter's; no provider-specific type crosses this boundary).

**New rule (6)**: `html` MUST always be provided alongside `text` by every caller of `send()` — this
feature has no code path that sends `text`-only. `ZeptoMailSender.send()` MUST include both
`message.text` as `textbody` and `message.html` as `htmlbody` in the request it posts — an addition
to the existing request shape documented in specs/016-email-api-mailer/contracts/zeptomail-api.md:

```json
{
  "from": { "address": "no-reply@example.com", "name": "TM" },
  "to": [
    { "email_address": { "address": "jordan.lee@acme.example", "name": "jordan.lee@acme.example" } }
  ],
  "subject": "Welcome to TM",
  "textbody": "Welcome to TM. Your login email is jordan.lee@acme.example...",
  "htmlbody": "<!doctype html>...<body>...</body></html>"
}
```

Everything else about the ZeptoMail request/response contract (auth header, 2xx/4xx-5xx handling,
error-message extraction) is unchanged from specs/016-email-api-mailer/contracts/zeptomail-api.md.

## Consumer contract (`apps/api/src/tenant-auth/mailer.ts`)

```typescript
export async function sendTenantCreationEmail(
  to: string,
  otp: string,
  tenantName: string,
): Promise<void>;

export async function sendMemberInviteEmail(
  to: string,
  otp: string,
  tenantName: string,
): Promise<void>;

export async function sendPasswordResetEmail(
  to: string,
  resetLink: string,
): Promise<void>; // signature unchanged from specs/016 — content only changes
```

**Changed from specs/016**: `sendOneTimePasswordEmail(to, otp)` is removed and replaced by the two
functions above (research.md §5). Every call site MUST be updated in the same change:
- `apps/api/src/provisioning/provision-tenant.ts` → `sendTenantCreationEmail(target.email, target.otp, target.tenantName)`
- `apps/api/src/tenant-auth/tenant-team-routes.ts` → `sendMemberInviteEmail(createdUser.email, oneTimePassword, tenantName)`

**Unchanged from specs/016**: All three functions MUST resolve successfully regardless of whether the
underlying `send()` succeeded, failed, or was skipped (spec 016 FR-004/FR-005, carried forward
unmodified by this feature) — no caller needs new error handling.
