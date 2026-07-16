# Quickstart: Validating the Transactional Email Template Redesign

Validates the feature end-to-end without needing a real ZeptoMail account or a live mail client —
uses the existing `RecordingMailSender` test seam (`apps/api/tests/unit/fixtures/recording-mail-sender.ts`)
and `__setMailSenderForTesting` (`apps/api/src/tenant-auth/mailer.ts`), the same pattern
`apps/api/tests/unit/mailer.test.ts` already uses.

## Prerequisites

- `apps/api` dependencies installed (`pnpm install` at the repo root, if not already done).
- A local Postgres the API test suite already points at (existing `apps/api` test setup — no new
  service needed for this feature).

## 1. Unit-level: template builder output

Fastest signal — no server, no DB.

```sh
cd apps/api
pnpm vitest run tests/unit/email-templates.test.ts
```

**Expected outcome**: For each of the three builders (`buildTenantCreationEmail`,
`buildMemberInviteEmail`, `buildPasswordResetEmail`):
- `result.html` contains the login-email / tenant-name / OTP (or reset link) as distinct, findable
  substrings — not just present somewhere in a paragraph.
- `result.text` contains the same set of facts as `result.html` (data-model.md validation rule).
- `buildTenantCreationEmail(...).subject` and `buildMemberInviteEmail(...).subject` differ, and a
  human skimming both `text` outputs can tell them apart without seeing the subject (spec SC-005).
- Passing a `tenantName` containing `<script>` or `&` renders safely in `html` (escaped) without
  breaking the surrounding markup (spec FR-007) — assert the raw tag does not appear unescaped.

## 2. Unit-level: mail transport carries `html`

```sh
pnpm vitest run tests/unit/mailer.test.ts tests/unit/zeptomail-sender.test.ts
```

**Expected outcome**:
- `mailer.test.ts`: calling each of `sendTenantCreationEmail`, `sendMemberInviteEmail`,
  `sendPasswordResetEmail` against a fake `MailSender` results in exactly one `send()` call whose
  `MailMessage.html` and `.text` are both non-empty and consistent with the inputs given — mirroring
  the existing skip-when-unconfigured / non-blocking-failure assertions already in this file, now
  exercised against the renamed exports.
- `zeptomail-sender.test.ts`: the JSON body posted to the mocked ZeptoMail endpoint includes both
  `textbody` and `htmlbody` matching the `MailMessage` given.

## 3. Integration-level: real trigger flows, recorded (not sent)

```sh
pnpm vitest run tests/integration/provision-tenant-otp-email.test.ts
pnpm vitest run tests/integration/tenant-auth-otp-forces-change.test.ts
```

(Update these — and add an equivalent for the member-invite route if none exists yet — to install a
`RecordingMailSender` via `__setMailSenderForTesting` before the flow runs, then assert on
`recordingSender.received[0]`.)

**Expected outcome for the provisioning flow**: after `provisionTenant(...)` resolves, exactly one
recorded message has `.to` equal to the created admin's email, and `.html`/`.text` both contain that
same email address as a labeled "login email" line (closing the gap spec.md's User Story 1 exists to
fix) plus the tenant's name and the OTP.

**Expected outcome for the member-invite flow**: after `POST /tenant/team` succeeds, the recorded
message's `.html`/`.text` state the inviting tenant's name and the new member's login email, with
wording distinguishable from the tenant-creation message's copy.

**Expected outcome for the forgot-password flow**: after `POST /tenant-auth/forgot-password`
succeeds for a known account, the recorded message's `.html` contains a distinctly styled reset
action and states the 1-hour/single-use language; `.text` contains the same reset link as a plain URL.

## 4. Manual visual check (optional but recommended before calling this "done")

Since automated tests can assert on markup/content but not human-perceived visual quality (spec
SC-002/SC-003 are about what a reader actually sees):

1. Temporarily point `MAIL_API_URL`/`MAIL_API_TOKEN`/`MAIL_FROM_EMAIL` (see
   `apps/api/src/mail/zeptomail-sender.ts`) at a real or sandboxed ZeptoMail account, or capture one
   of the three `EmailTemplateResult.html` strings from a debugger/test and save it as a local
   `.html` file.
2. Open it in a browser (quick check) and, if available, an actual mail client (Gmail web + one
   desktop client if possible) to confirm the table layout renders correctly and the highlighted
   OTP/reset-link block is the first thing a skimming reader's eye lands on.
3. Confirm all three variants are visually consistent with each other (same shell) and with the
   in-app product's navy/blue identity (`design-system/tm/MASTER.md`).

## Success signal

All of steps 1–3 pass, and step 4's visual check confirms the branded shell renders correctly and the
credential/link is the clear visual focal point — matching spec.md's Success Criteria SC-001 through
SC-005.
