---

description: "Task list for implementing the Transactional Email Template Redesign feature"
---

# Tasks: Transactional Email Template Redesign

**Input**: Design documents from `/specs/019-email-template-redesign/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md,
data-model.md, contracts/ (`mail-transport-interface.md`, `email-template-builders.md`),
quickstart.md

**Tests**: Included — this repo's established convention for the mail-transport layer (spec
016-email-api-mailer's own task list) is tests-first for every wrapper/adapter change, and this
feature both changes that transport (`MailMessage` gains `html`) and adds new pure functions
(`email-templates.ts`) that are trivially and cheaply unit-testable.

**Dependency sign-off status**: None needed — this feature adds no new package (plan.md "New
Dependencies Requiring Justification": None; research.md §2). No task in this list should run
`pnpm add`.

**A note on renamed exports**: `mailer.ts`'s `sendOneTimePasswordEmail(to, otp)` is replaced by two
functions, `sendTenantCreationEmail(to, otp, tenantName)` and
`sendMemberInviteEmail(to, otp, tenantName)` (research.md §5, contracts/mail-transport-interface.md).
Every existing reference to the old name — in `provision-tenant.ts`, `tenant-team-routes.ts`, and the
three test files that import it (`mailer.test.ts`, `mailer-provider-swap.test.ts`) — is a task below.
`sendPasswordResetEmail(to, resetLink)` keeps its name and signature; only its content changes.

## Format: `[ID] [P?] [Story?] Description with file path (Backend-only)`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Maps the task to its user story (US1–US3); Setup/Foundational/Polish tasks carry no
  story label
- Every task in this feature is `(Backend-only)` — `apps/api` only, no `apps/web` change
  (plan.md Project Structure)

---

## Phase 1: Setup

- [X] T001 Confirm no new dependency is required (research.md §2): the HTML template is built with
  plain TypeScript template literals and a local `escapeHtml()` helper — no MJML/react-email/
  handlebars package gets installed. A documentation/gate check, not a code change. (Backend-only)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Widen the mail transport to carry HTML, and stand up the shared template shell every
user story's builder function renders through. No user story can be implemented until this phase is
done.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 [P] Add `html: string` to the `MailMessage` interface in
  `apps/api/src/mail/mail-sender.ts` (contracts/mail-transport-interface.md). (Backend-only)
- [X] T003 [P] Update `apps/api/tests/unit/zeptomail-sender.test.ts`: add an `html` field to every
  existing `.send({...})` call literal (7 call sites), and extend "sends the exact request shape"
  to assert the posted JSON body includes `htmlbody` alongside `textbody`. Written to FAIL against
  today's adapter, ahead of T004. (Backend-only)
- [X] T004 Update `apps/api/src/mail/zeptomail-sender.ts`'s `send()` to include
  `htmlbody: message.html` in the request body it posts (depends on T002; makes T003 pass).
  (Backend-only)
- [X] T005 [P] Write `apps/api/tests/unit/email-templates.test.ts`: unit tests for a local
  `escapeHtml()` helper (escapes `<`, `>`, `&`, `"`, `'`) and for the shared shell-rendering helper's
  structural output (research.md §3–§4: a `<table role="presentation">`-based, `max-width: 600px`,
  inline-styled wrapper that accepts a heading/body/highlight-block/footer and returns
  `{ subject, text, html }`-shaped pieces). Written to FAIL ahead of T006. (Backend-only)
- [X] T006 Create `apps/api/src/mail/email-templates.ts`: the `escapeHtml()` helper, the
  `EmailTemplateResult` type (data-model.md), and the shared shell renderer using the design tokens
  from research.md §3 (`#0F172A` primary / `#0369A1` CTA / `#F8FAFC` background / `#020617` text,
  Plus Jakarta Sans with system-font fallback, `--space-md`/`--space-lg` spacing, 12px card radius).
  No builder functions yet — those are story-specific (T010, T016, T022). Depends on T002 (needs the
  `html` shape it will help produce) and T005 (TDD). (Backend-only)

**Checkpoint**: Foundation ready — `MailMessage` carries `html`, ZeptoMail sends it, and a shared,
brand-consistent shell exists for every story's builder to render through.

---

## Phase 3: User Story 1 - New tenant admin receives a clear, self-contained welcome email (Priority: P1) 🎯 MVP

**Goal**: The tenant-creation email states the tenant/company name and the admin's login email
address explicitly, alongside the OTP and its 72-hour expiry, rendered as a branded HTML message with
a plain-text fallback.

**Independent Test**: Call `buildTenantCreationEmail(...)` directly and inspect its output; separately,
provision a new tenant end-to-end with a `RecordingMailSender` installed and inspect the one recorded
message — neither requires User Story 2 or 3 to exist.

### Tests for User Story 1

- [X] T007 [P] [US1] Add `buildTenantCreationEmail` tests to
  `apps/api/tests/unit/email-templates.test.ts`: given `{ loginEmail, tenantName, oneTimePassword,
  otpValidityHours: 72 }`, assert `subject` reads as a new-account welcome, `text` and `html` both
  contain the login email, tenant name, OTP, and "72" hours as separate labeled facts (not folded
  into one sentence — spec FR-001/FR-006), and that a `tenantName` containing `<b>injected</b>`
  renders escaped (not as live markup) in `html` (spec FR-007). Written to FAIL ahead of T010.
  (Backend-only)
- [X] T008 [P] [US1] Update `apps/api/tests/unit/mailer.test.ts`: replace every
  `sendOneTimePasswordEmail("user@example.com", "123456")`-style call used for the tenant-creation
  wrapper-guarantee assertions with `sendTenantCreationEmail("user@example.com", "123456", "Acme
  Co")`, and extend the "calls send() with the expected MailMessage shape" test to also assert
  `received?.html` is truthy and contains the OTP. Written to FAIL ahead of T011. (Backend-only)
- [X] T009 [P] [US1] Write `apps/api/tests/integration/provision-tenant-welcome-email.test.ts`:
  install a `RecordingMailSender` via `__setMailSenderForTesting` before calling `provisionTenant`
  (mirroring `apps/api/tests/unit/mailer-provider-swap.test.ts`'s pattern), provision a tenant, and
  assert the one recorded message's `.to` is the admin's email and its `.html`/`.text` contain that
  same email address as a labeled "login email" line plus the tenant's name and the OTP — the exact
  gap spec.md's User Story 1 exists to close. Written to FAIL ahead of T012. (Backend-only)

### Implementation for User Story 1

- [X] T010 [US1] Implement `buildTenantCreationEmail` in `apps/api/src/mail/email-templates.ts`
  using the T006 shell (contracts/email-template-builders.md rules 1, 2, 4, 5, 6). Makes T007 pass.
  (Backend-only)
- [X] T011 [US1] Update `apps/api/src/tenant-auth/mailer.ts`: remove `sendOneTimePasswordEmail`,
  add `export async function sendTenantCreationEmail(to: string, otp: string, tenantName: string):
  Promise<void>` that calls `buildTenantCreationEmail` (with `otpValidityHours: 72`) and passes the
  result into the existing `sendMail()` wrapper unchanged. Depends on T010; makes T008 pass.
  (Backend-only)
- [X] T012 [US1] Update `apps/api/src/provisioning/provision-tenant.ts`: thread the tenant's name
  through `sendProvisioningOneTimePasswordEmail` and call
  `sendTenantCreationEmail(target.email, target.otp, target.tenantName)` in place of
  `sendOneTimePasswordEmail(target.email, target.otp)` (using `createdTenant.name`, already in scope
  at the call site — research.md §6). Depends on T011; makes T009 pass. (Backend-only)

**Checkpoint**: User Story 1 is fully functional and independently testable — a newly provisioned
tenant's admin now receives a branded email that explicitly states their login email.

---

## Phase 4: User Story 2 - Invited team member receives a clear, branded invite email (Priority: P2)

**Goal**: The member-invite email states which tenant/organization the recipient is joining, their
login email, the OTP, and its expiry — wording distinguishable from the tenant-creation email even
though both share the same visual shell.

**Independent Test**: Call `buildMemberInviteEmail(...)` directly; separately, invite a team member
into an existing tenant with a `RecordingMailSender` installed and inspect the recorded message —
does not require User Story 1's call site to be exercised, only its (already-shared) shell code.

### Tests for User Story 2

- [X] T013 [P] [US2] Add `buildMemberInviteEmail` tests to
  `apps/api/tests/unit/email-templates.test.ts`: same fact-coverage assertions as T007
  (loginEmail/tenantName/OTP/expiry, escaping), plus an explicit comparison —
  `buildMemberInviteEmail(...).subject` and `.text` must differ from
  `buildTenantCreationEmail(...)`'s output for equivalent inputs (spec FR-003, SC-005). Written to
  FAIL ahead of T016. (Backend-only)
- [X] T014 [P] [US2] Update `apps/api/tests/unit/mailer.test.ts`: add wrapper-guarantee coverage for
  the new `sendMemberInviteEmail(to, otp, tenantName)` export (skip-when-unconfigured,
  non-blocking-failure, timeout-bounded, expected `MailMessage` shape with `html`) — same four
  guarantees already proven for the other exports. Written to FAIL ahead of T017. (Backend-only)
- [X] T015 [P] [US2] Write `apps/api/tests/integration/tenant-team-invite-email.test.ts`: install a
  `RecordingMailSender`, call the `POST /tenant/team` route (or the underlying handler) to invite a
  member into a tenant with a known name, and assert the recorded message's `.html`/`.text` state
  that tenant's name and the new member's login email, with wording distinguishable from a
  tenant-creation email. Written to FAIL ahead of T018. (Backend-only)

### Implementation for User Story 2

- [X] T016 [US2] Implement `buildMemberInviteEmail` in `apps/api/src/mail/email-templates.ts` using
  the T006 shell, with invite-specific copy distinct from `buildTenantCreationEmail`
  (contracts/email-template-builders.md rules 1, 2, 4, 5, 6). Makes T013 pass. (Backend-only)
- [X] T017 [US2] Add `export async function sendMemberInviteEmail(to: string, otp: string,
  tenantName: string): Promise<void>` to `apps/api/src/tenant-auth/mailer.ts`, calling
  `buildMemberInviteEmail` (with `otpValidityHours: 72`) through the existing `sendMail()` wrapper.
  Depends on T016; makes T014 pass. (Backend-only)
- [X] T018 [US2] Update `apps/api/src/tenant-auth/tenant-team-routes.ts`: before sending, read the
  inviting tenant's name via `request.tenantDb.select({ name: tenants.name }).from(tenants).where(eq
  (tenants.id, tenantId))` (RLS-scoped to the caller's own tenant row — research.md §6), then call
  `sendMemberInviteEmail(createdUser.email, oneTimePassword, tenantName)` in place of
  `sendOneTimePasswordEmail(createdUser.email, oneTimePassword)`. Depends on T017; makes T015 pass.
  (Backend-only)

**Checkpoint**: User Stories 1 AND 2 both work independently — tenant-creation and member-invite
emails are now visually consistent but textually distinct.

---

## Phase 5: User Story 3 - User requesting a password reset receives a clear, branded reset email (Priority: P3)

**Goal**: The password-reset email highlights the reset link/action, states its 1-hour/single-use
nature, and includes a safe-to-ignore note — rendered through the same branded shell as the other two
emails.

**Independent Test**: Call `buildPasswordResetEmail(...)` directly; separately, trigger the
forgot-password flow with a `RecordingMailSender` installed and inspect the recorded message —
independent of both other stories' call sites.

### Tests for User Story 3

- [X] T019 [P] [US3] Add `buildPasswordResetEmail` tests to
  `apps/api/tests/unit/email-templates.test.ts`: given `{ resetLink, linkValidityHours: 1 }`, assert
  `html` renders the link as a distinctly highlighted button-styled action and `text` renders it as a
  plain URL, and both contain "1 hour"/single-use language and an ignore-if-not-you note (spec
  FR-004). Written to FAIL ahead of T022. (Backend-only)
- [X] T020 [P] [US3] Update `apps/api/tests/unit/mailer.test.ts`'s existing `sendPasswordResetEmail`
  assertions to match the new branded content shape (still a 2-argument call, no rename), including
  that `received?.html` is truthy. Written to FAIL ahead of T023. (Backend-only)
- [X] T021 [P] [US3] Write `apps/api/tests/integration/forgot-password-reset-email.test.ts`: install
  a `RecordingMailSender`, trigger `POST /tenant-auth/forgot-password` for a known account, and
  assert the recorded message's `.html`/`.text` contain the same reset link the route generated,
  plus the 1-hour/single-use/ignore-note language. Written to FAIL ahead of T023. (Backend-only)

### Implementation for User Story 3

- [X] T022 [US3] Implement `buildPasswordResetEmail` in `apps/api/src/mail/email-templates.ts` using
  the T006 shell (contracts/email-template-builders.md rules 3, 4, 5). Makes T019 pass. (Backend-only)
- [X] T023 [US3] Update `sendPasswordResetEmail` in `apps/api/src/tenant-auth/mailer.ts` to call
  `buildPasswordResetEmail` (with `linkValidityHours: 1`, matching `RESET_TOKEN_VALIDITY_MS` in
  `tenant-auth-routes.ts` — research.md §8) instead of building its own subject/text strings inline.
  Signature unchanged. Depends on T022; makes T020 and T021 pass. No change needed in
  `tenant-auth-routes.ts` itself — its `sendPasswordResetEmail(email, resetLink)` call site is
  already signature-compatible. (Backend-only)

**Checkpoint**: All three user stories are independently functional — every transactional email TM
sends is now branded, and both OTP variants explicitly state the recipient's login email.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T024 [P] Update `apps/api/tests/unit/mailer-provider-swap.test.ts`: replace its
  `sendOneTimePasswordEmail(...)` call with `sendTenantCreationEmail(...)` (or add a second
  assertion for `sendMemberInviteEmail`) so this test keeps proving a `MailSender` swap needs zero
  call-site changes, using the current export names. (Backend-only)
- [X] T025 [P] Run `grep -rn "sendOneTimePasswordEmail" apps/api/src apps/api/tests` and confirm zero
  matches remain anywhere in the codebase — a stale reference here would be a silent compile break
  masked only if the file happens not to be type-checked. (Backend-only)
- [X] T026 Run `pnpm --filter api type-check` and `pnpm --filter api lint` and fix any fallout from
  the `MailMessage.html` field becoming required or the renamed exports. (Backend-only)
- [X] T027 Run `pnpm --filter api test` (all of `apps/api/tests/unit` and
  `apps/api/tests/integration`) and confirm every test from T003–T021 passes together, not just
  individually. (Backend-only)
- [X] T028 [P] Manual visual check per quickstart.md step 4: render each of the three
  `EmailTemplateResult.html` outputs (via a debugger breakpoint or a throwaway script) and open them
  in a browser and, if available, an actual mail client, confirming the table layout renders
  correctly, the OTP/reset-link block is the clear focal point (spec SC-003), and all three variants
  are visually consistent with each other and with `design-system/tm/MASTER.md`. (Backend-only)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories (every story's
  builder function renders through the T006 shell, and every story's `mailer.ts` export returns a
  `MailMessage` whose `html` field only exists after T002/T004).
- **User Stories (Phase 3–5)**: All depend on Foundational phase completion.
  - US1, US2, US3 do not depend on each other's call-site changes (different files:
    `provision-tenant.ts`, `tenant-team-routes.ts`, `tenant-auth-routes.ts`) and can proceed in
    parallel once Phase 2 is done, or sequentially in priority order (P1 → P2 → P3).
  - All three add sibling functions/builders inside the same two shared files
    (`email-templates.ts`, `mailer.ts`) — parallel work across stories on those two files should
    coordinate to avoid edit conflicts even though the stories are logically independent.
- **Polish (Phase 6)**: Depends on all three user stories being complete (T024–T027 assert on the
  full renamed export surface; T028 wants all three templates to compare against each other).

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) — no dependency on US2/US3.
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) — no dependency on US1's call-site
  change, only on the shared T006 shell.
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) — no dependency on US1/US2.

### Within Each User Story

- Tests (T007–T009, T013–T015, T019–T021) are written first and must FAIL before the corresponding
  implementation task, matching this repo's established convention (specs/016's own tasks.md).
- Builder function (e.g. T010) before the `mailer.ts` export that calls it (e.g. T011) before the
  route call-site update (e.g. T012).
- Story complete before moving to the next priority, if working sequentially.

### Parallel Opportunities

- T002 and T003 can run in parallel (different files); T005 can run in parallel with both.
- Once Phase 2 completes, all three stories' test tasks (T007+T008+T009, T013+T014+T015,
  T019+T020+T021) can be drafted in parallel across stories, and all three stories' implementation
  chains can proceed in parallel if staffed, subject to the shared-file coordination note above.
- T024, T025, T028 in Polish can run in parallel with each other; T026 and T027 are sequential gates
  that want the rest of the phase's file changes settled first.

---

## Parallel Example: User Story 1

```bash
# Tests for User Story 1 (can be drafted together):
Task: "Add buildTenantCreationEmail tests to apps/api/tests/unit/email-templates.test.ts"
Task: "Update apps/api/tests/unit/mailer.test.ts for sendTenantCreationEmail"
Task: "Write apps/api/tests/integration/provision-tenant-welcome-email.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001).
2. Complete Phase 2: Foundational (T002–T006) — CRITICAL, blocks all stories.
3. Complete Phase 3: User Story 1 (T007–T012).
4. **STOP and VALIDATE**: run `apps/api/tests/unit/email-templates.test.ts`,
   `apps/api/tests/unit/mailer.test.ts`, and
   `apps/api/tests/integration/provision-tenant-welcome-email.test.ts` in isolation; confirm the
   tenant-creation email now states the admin's login email.
5. Demo if ready — this alone closes the specific gap ("only sending OTP") called out in the original
   feature request.

### Incremental Delivery

1. Setup + Foundational → shared shell and HTML transport ready.
2. Add User Story 1 → validate independently → demo (MVP — closes the tenant-creation content gap).
3. Add User Story 2 → validate independently → demo (member-invite email now distinct and branded).
4. Add User Story 3 → validate independently → demo (password-reset email now branded).
5. Phase 6 Polish → confirm the full renamed export surface is consistent and nothing stale remains.

### Parallel Team Strategy

With multiple developers, after Phase 2 is done:
- Developer A: User Story 1 (T007–T012)
- Developer B: User Story 2 (T013–T018)
- Developer C: User Story 3 (T019–T023)

Each adds a sibling builder function to `email-templates.ts` and a sibling export to `mailer.ts` —
coordinate on those two shared files (e.g. land in small sequential PRs) even though the stories
themselves are logically independent.

---

## Notes

- [P] tasks = different files, no dependency on an incomplete task.
- [Story] label maps task to specific user story for traceability.
- Every story is independently completable and testable per its own Independent Test above.
- Verify each test task fails before starting its paired implementation task.
- Commit after each task or logical group.
- Stop at any checkpoint to validate a story independently before continuing.
- Avoid: reintroducing a single `kind`-flag OTP function (research.md §5 rejected this), skipping the
  `escapeHtml()` pass on tenant-supplied names (spec FR-007), and text/html fact drift (spec FR-005).
