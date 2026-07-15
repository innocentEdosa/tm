# Quickstart: Email API Mailer

Validates the transport swap end-to-end. No database setup is needed — this feature touches no
table. Assumes `apps/api` builds and its existing test suite already passes before this feature's
changes (baseline).

## Prerequisites

- `apps/api/.env` configured per the amended `.env.example` — for the manual-send scenario below,
  real `MAIL_API_TOKEN`/`MAIL_FROM_EMAIL` values from a ZeptoMail account with at least one verified
  sender identity. For the automated scenarios (unit + integration tests), no credentials are needed
  at all.

## Scenario 1 — Unit: the ZeptoMail adapter builds the right request and handles every response shape

```sh
pnpm --filter api vitest run tests/unit/zeptomail-sender.test.ts
```

**Expected**: All cases pass — a mocked 2xx `fetch` resolves `send()`; a mocked 4xx/5xx response
throws with the provider's error message attached; a mocked network rejection and a simulated
timeout both throw; the request sent to the mocked `fetch` matches contracts/zeptomail-api.md's
shape exactly (method, headers, JSON body fields).

**Verifies**: FR-001 (transport is now HTTP-API-based), data-model.md's request/response mapping.

## Scenario 2 — Unit: `mailer.ts`'s wrapper guarantees hold for any `MailSender`

```sh
pnpm --filter api vitest run tests/unit/mailer.test.ts
```

**Expected**: Using a hand-written fake `MailSender` (not ZeptoMail) —
a) `isConfigured() === false` → no call to `send()` is made, a warning is logged, the wrapper
   resolves without throwing;
b) `send()` rejects → the wrapper resolves without throwing, the failure is logged;
c) `send()` never resolves (simulated hang) → the wrapper still resolves within the timeout budget,
   without throwing.

**Verifies**: FR-004, FR-005, FR-006, FR-009; User Story 2 Acceptance Scenario 2 (guarantees hold
independent of which adapter is active).

## Scenario 3 — Integration: the three existing call sites are unaffected with no credentials configured

```sh
pnpm --filter api test
```

**Expected**: The full existing suite passes unchanged, including
`tests/integration/provision-tenant-otp-email.test.ts` and any team-invite/password-reset
integration tests — with `MAIL_API_TOKEN`/`MAIL_FROM_EMAIL` unset in the test environment (the
default), each triggering operation (provisioning, invite, password-reset request) still completes
successfully.

**Verifies**: FR-004, FR-005; SC-002, SC-004.

## Scenario 4 — Manual: a real email actually arrives via ZeptoMail

```sh
# With real MAIL_API_TOKEN / MAIL_FROM_EMAIL set in apps/api/.env:
pnpm --filter api dev
# Then, in another terminal, trigger a real OTP or password-reset email through the existing
# provisioning or forgot-password flow (see specs/002-tenant-provisioning-core/quickstart.md and
# specs/005-tenant-auth-config/quickstart.md for the exact requests) and check the recipient inbox.
```

**Expected**: The email arrives with the same subject/body as before this change, sent via
ZeptoMail rather than SMTP — confirmed by checking the request in ZeptoMail's own dashboard (shows
as sent via the API, not SMTP) as well as the inbox itself.

**Verifies**: User Story 1 end-to-end (the one thing all the unit/integration coverage above can't
prove by itself: that ZeptoMail's real API actually accepts the request and delivers).

## Scenario 5 — Provider-swap drill (proves the abstraction, not just the ZeptoMail migration)

Add a second, throwaway `MailSender` implementation (e.g. one that just logs to console instead of
calling any API), wire it in as the active sender in `mailer.ts` instead of the ZeptoMail one, and
re-run Scenario 3.

**Expected**: Zero changes needed to `provision-tenant.ts`, `tenant-team-routes.ts`, or
`tenant-auth-routes.ts`, or to either public `mailer.ts` function signature — the full test suite
still passes.

**Verifies**: User Story 2, SC-003.
