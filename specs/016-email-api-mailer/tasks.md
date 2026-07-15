---

description: "Task list for implementing the Email API Mailer feature"
---

# Tasks: Email API Mailer

**Input**: Design documents from `/specs/016-email-api-mailer/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md,
contracts/ (`mail-sender-interface.md`, `zeptomail-api.md`), quickstart.md

**Tests**: Included — this is a transport swap with real distinguishable success/failure states
(configured vs. not, 2xx vs. error vs. timeout) that are exactly the kind of thing that must be
proven rather than assumed, and this repo has zero prior precedent for mocking `fetch` (research.md
§6), so the test tasks below are also where that pattern gets established for the first time.

**Dependency sign-off status**: None needed — this feature adds no new package (research.md §2, §7;
plan.md Technical Context). No task in this list should run `pnpm add`.

**A note on the test seam**: `mailer.ts` gains a test-only setter (`__setMailSenderForTesting`) to
swap the active `MailSender`, mirroring this codebase's own existing precedent —
`apps/api/src/server.ts`'s `BuildServerOptions.registerAuthStub`, itself documented as "never passed
in production." This makes both the wrapper-guarantee tests (US1) and the provider-swap proof (US2)
permanent, repeatable automated tests rather than a manual "wire it in, then revert" drill.

## Format: `[ID] [P?] [Story?] Description with file path (Backend-only)`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Maps the task to its user story (US1–US3); Setup/Foundational/Polish tasks carry no
  story label
- Every task in this feature is `(Backend-only)` — this feature has no frontend surface at all
  (plan.md Project Structure)

---

## Phase 1: Setup

- [X] T001 Confirm no new dependency is required (research.md §2, §7): Node 20's global `fetch` and
  `AbortSignal.timeout()` are available with no import, and no `zeptomail` (or any other) package is
  installed — a documentation/gate check, not a code change. (Backend-only)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The one shared contract every adapter (current and future) implements against.
**Nothing in Phase 3+ can start until this phase is complete.**

- [X] T002 Define `MailMessage` and `MailSender` in `apps/api/src/mail/mail-sender.ts` per
  contracts/mail-sender-interface.md and data-model.md (`isConfigured(): boolean`,
  `send(message: MailMessage): Promise<void>`, `MailMessage` = `{ to, subject, text }`). No
  implementation logic here — the interface only. (Backend-only)

**Checkpoint**: Foundation ready — the contract every story below builds against exists.

---

## Phase 3: User Story 1 - Existing Emails Keep Arriving, Now Sent via an HTTP API (Priority: P1) 🎯 MVP

**Goal**: The two existing email types send via ZeptoMail's HTTP API instead of SMTP, with every
existing behavioral guarantee (non-blocking failure, skip-when-unconfigured, bounded timeout)
preserved exactly.

**Independent Test**: quickstart.md Scenarios 1–3 — unit-test the ZeptoMail adapter's request/
response handling, unit-test `mailer.ts`'s wrapper guarantees with a fake sender, then run the full
existing test suite with no credentials configured and confirm it's unaffected.

### Tests for User Story 1

- [X] T003 [P] [US1] Write `apps/api/tests/unit/zeptomail-sender.test.ts` (Vitest, `global.fetch`
  mocked via `vi.stubGlobal`): asserts the exact request sent — method, `Authorization:
  zoho-enczapikey <token>` header, JSON body shape (`from`/`to`/`subject`/`textbody`) per
  contracts/zeptomail-api.md — for a given `MailMessage`; a mocked 2xx response resolves `send()`; a
  mocked 4xx/5xx response throws with the provider's `error.message` attached; a mocked `fetch`
  rejection (network failure) throws. Depends on T002.
- [X] T004 [P] [US1] Write `apps/api/tests/unit/mailer.test.ts` (Vitest): using
  `__setMailSenderForTesting` (T006) to install a hand-written fake `MailSender` (not ZeptoMail),
  assert (a) `isConfigured() === false` → `send()` is never called, a warning is logged, the call
  resolves without throwing (FR-005); (b) a fake `send()` that rejects → resolves without throwing,
  the failure is logged (FR-004, FR-009); (c) a fake `send()` that never resolves → the call still
  resolves within the timeout budget without throwing (FR-006). Depends on T002, T006.

### Implementation for User Story 1

- [X] T005 [US1] Implement `apps/api/src/mail/zeptomail-sender.ts`: a `ZeptoMailSender` class/object
  implementing `MailSender` (T002). `isConfigured()` returns true only if `MAIL_API_TOKEN` and
  `MAIL_FROM_EMAIL` are both set and non-empty. `send()` POSTs to `MAIL_API_URL` (default
  `https://api.zeptomail.com/v1.1/email`) with the request/response shape from
  contracts/zeptomail-api.md and data-model.md's field mapping, `from.name` defaulting to
  `MAIL_FROM_NAME` or `"TM"`, using `signal: AbortSignal.timeout(3000)` (research.md §4); throws on
  any non-2xx status (including the parsed `error.message` where present) or `fetch` rejection.
  Depends on T002. (Backend-only)
- [X] T006 [US1] Amend `apps/api/src/tenant-auth/mailer.ts`: remove the `nodemailer`/SMTP transport
  and `getTransport()`/`isSmtpConfigured()` helpers entirely; hold one module-level `activeSender:
  MailSender` (defaulting to `new ZeptoMailSender()`, from T005) plus an exported
  `__setMailSenderForTesting(sender: MailSender): void` test-only seam (mirrors
  `server.ts`'s `registerAuthStub` precedent — never called outside tests); implement a private
  `sendMail(message: MailMessage): Promise<void>` that checks `activeSender.isConfigured()` (log a
  warning and return if false, per FR-005), otherwise races `activeSender.send(message)` against a
  3000ms timeout via `Promise.race` (research.md §4) inside a try/catch that logs and never rethrows
  (FR-004, FR-006, FR-009); `sendOneTimePasswordEmail(to, otp)` and
  `sendPasswordResetEmail(to, resetLink)` keep their exact existing signatures, build a `MailMessage`
  with today's unchanged subject/body text, and call `sendMail`. Depends on T005. (Backend-only)
- [X] T007 [P] [US1] Amend `apps/api/.env.example`: replace `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/
  `SMTP_PASSWORD`/`SMTP_FROM` with `MAIL_API_TOKEN`/`MAIL_FROM_EMAIL`/`MAIL_FROM_NAME`/`MAIL_API_URL`
  per data-model.md's Configuration table, keeping the same "real credentials required to actually
  send... an empty/unset value is treated as not-configured and skipped" comment style already used
  there. Depends on T006. (Backend-only)
- [X] T008 [US1] Run `pnpm --filter api test` with no `MAIL_*` credentials configured and confirm
  `tests/integration/provision-tenant-otp-email.test.ts` and every other test exercising the three
  call sites (tenant provisioning, team invite, password reset) still passes unchanged — proving
  FR-004/FR-005 hold end-to-end, not just at the unit level (quickstart.md Scenario 3; SC-002,
  SC-004). Depends on T006, T007. (Backend-only)

**Checkpoint**: User Story 1 is fully functional and independently testable — emails send via
ZeptoMail's API, every existing guarantee holds, the full suite is green with zero credentials
configured.

---

## Phase 4: User Story 2 - Swapping Providers Later Touches Nothing but One New Adapter (Priority: P2)

**Goal**: Prove, with a real (if throwaway) second adapter, that a provider swap never requires
touching a call site or a public `mailer.ts` signature.

**Independent Test**: quickstart.md Scenario 5 — introduce a second `MailSender` implementation, wire
it in via the test seam, and confirm the three call sites and `mailer.ts`'s public functions needed
zero changes.

### Tests for User Story 2

- [X] T009 [P] [US2] Write `apps/api/tests/unit/fixtures/recording-mail-sender.ts`: a minimal,
  throwaway `MailSender` implementation (e.g. `isConfigured()` always `true`, `send()` pushes the
  received `MailMessage` onto an in-memory array instead of calling any API) — used only by T010,
  never wired in outside tests. Depends on T002.
- [X] T010 [US2] Write `apps/api/tests/unit/mailer-provider-swap.test.ts`: install the T009 fixture
  via `__setMailSenderForTesting` (T006), call `sendOneTimePasswordEmail`/`sendPasswordResetEmail`
  directly, and assert the fixture recorded the expected `MailMessage` — proving the swap required no
  change to either public function's signature or behavior, without needing to touch
  `provision-tenant.ts`/`tenant-team-routes.ts`/`tenant-auth-routes.ts` at all (spec User Story 2 AS1,
  AS2; SC-003). Depends on T009, T006.

**Checkpoint**: User Stories 1 and 2 both work independently — the migration is done, and the
swap-friendliness it was built for is proven, not just asserted.

---

## Phase 5: User Story 3 - Configuration Doesn't Change Names on Every Provider Swap (Priority: P3)

**Goal**: Confirm every email-related environment variable read outside the ZeptoMail adapter uses a
provider-agnostic name, and the old `SMTP_*` variables are read nowhere.

**Independent Test**: quickstart.md's implicit audit (spec User Story 3 AS1) — search the codebase
for env var reads related to email sending and confirm the naming boundary holds.

### Implementation for User Story 3

- [X] T011 [US3] Verify the environment-variable boundary: run `grep -rn "SMTP_\|process\.env\.MAIL_"
  apps/api/src` and confirm (a) zero remaining `SMTP_` references anywhere in `apps/api/src`, and
  (b) every `MAIL_*` reference is inside `apps/api/src/mail/zeptomail-sender.ts` — `mailer.ts` and the
  three call sites reference none of them directly (FR-007). Depends on T006, T007.

**Checkpoint**: All three user stories are independently functional. Feature complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T012 [P] **BLOCKED — needs a real ZeptoMail account.** Run quickstart.md Scenario 4 with a real
  ZeptoMail account (`MAIL_API_TOKEN`/`MAIL_FROM_EMAIL` set to real values): trigger one OTP email
  and one password-reset email through their existing flows and confirm both actually arrive, with
  the same subject/body as before this change, and show as sent via ZeptoMail's API in ZeptoMail's
  own dashboard (User Story 1 end-to-end — the one thing no unit/integration test can prove by
  itself). Not runnable in this environment — no real `MAIL_API_TOKEN` is available. All other
  verification (unit tests against the documented ZeptoMail request/response contract, full
  regression suite) is green; this is the one manual, credentials-gated step left before shipping.
- [X] T013 [P] Run `pnpm --filter api type-check` and the full `pnpm --filter api test` suite one
  final time as a whole-repo regression gate, confirming zero unrelated tests were affected by the
  `mailer.ts` rewrite.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories (the `MailSender` interface
  every adapter and every test double implements).
- **User Stories (Phase 3–5)**: All depend on Foundational completion.
  - US2 and US3 both depend on US1's `mailer.ts` rewrite (T006) existing — specifically the
    `__setMailSenderForTesting` seam (US2) and the final `MAIL_*`-only env var surface (US3) — so in
    practice US1 ships first even though US2/US3 are conceptually independent of each other.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each User Story

- Tests are written first (and should fail before implementation, matching this repo's established
  precedent from prior specs).
- Interface before adapter; adapter before the wrapper that wires it in; wrapper before anything that
  depends on the test seam it exposes.
- Each story's checkpoint marks it independently demoable before moving to the next priority.

### Parallel Opportunities

- T003 and T004 (US1's two test files) can be drafted in parallel, though T004 cannot actually run
  green until T006 exists (the test seam it depends on).
- T007 (env.example) can happen in parallel with T005 (adapter implementation) — different files.
- T012 and T013 (Polish) are independent of each other.

---

## Parallel Example: User Story 1

```bash
# Tests for User Story 1 (can be drafted together, though T004 needs T006 to actually pass):
Task: "Write apps/api/tests/unit/zeptomail-sender.test.ts"
Task: "Write apps/api/tests/unit/mailer.test.ts"

# Once T002 (interface) is done:
Task: "Implement apps/api/src/mail/zeptomail-sender.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational — the `MailSender` interface.
3. Complete Phase 3: User Story 1 — ZeptoMail sends the same two emails, every existing guarantee
   holds, full suite green.
4. **STOP and VALIDATE**: run quickstart.md Scenarios 1–3.
5. Deploy/demo if ready — this alone is the entire stated goal (SMTP → API), even before the
   swap-friendliness of User Story 2 is proven with a second adapter.

### Incremental Delivery

1. Setup + Foundational → the interface exists.
2. US1 → the migration itself is done and verified (MVP).
3. US2 → the abstraction's actual selling point (cheap future swaps) is proven, not just designed.
4. US3 → the env-var-naming half of that same promise is confirmed with a quick audit.
5. Polish → one real send through ZeptoMail, one final whole-suite regression pass.

---

## Notes

- [P] tasks = different files, no dependencies.
- [Story] label maps task to specific user story for traceability.
- This feature is unusually small (13 tasks vs. prior specs' 30+) because it is a single-module
  transport swap with no database and no UI — resist the temptation to pad it with unrelated
  cleanup; the point is precisely how small and low-risk a well-abstracted infra swap can be.
- Commit after each task or logical group.
- Stop at any checkpoint to validate a story independently.
