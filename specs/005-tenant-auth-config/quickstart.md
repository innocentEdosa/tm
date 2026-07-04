# Quickstart: Tenant Authentication Configuration

Validates the feature end-to-end against a local dev stack. Assumes Specs 1–4's migrations are
already applied.

## Prerequisites

- Local Postgres running via `docker-compose.yml` (`docker compose up -d postgres`).
- `apps/api/.env` configured with `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM`
  (a real, reachable SMTP account — see contracts/nextjs-tenant-auth-pages.md).
- `apps/web/.env` unchanged from Spec 4 (`ROOT_DOMAIN=lvh.me`, `API_ORIGIN`).

## Setup

```sh
pnpm --filter api db:generate   # generates this feature's migrations from the schema changes
pnpm --filter api db:migrate    # applies users columns + 3 new tables + permission backfill
pnpm --filter api dev
pnpm --filter web dev
```

## Scenario 1 — Provisioning creates a working, emailed login (US1, US5)

```sh
# Provision a tenant via the existing flow (Spec 2), as Super Admin
curl -s -X POST http://localhost:3001/provisioning/tenants \
  -H "content-type: application/json" -b "tm_super_admin_session=<value>" \
  -d '{"company":{"name":"Acme Corp","subdomain":"acmecorp","primaryContact":{"name":"Jo","email":"jo@acme.example"}},"admin":{"fullName":"Jo Admin","email":"jo@acme.example"}}'
```

**Expected**: `201`, and the admin's inbox receives a one-time-password email. Visit
`http://acmecorp.lvh.me:3000/` — the login page shows only "Email/Password" (the provisioning
default, spec FR-003).

## Scenario 2 — Login with the OTP forces a password change (US5)

```sh
curl -s -i -X POST "http://acmecorp.lvh.me:3000/tenant-api/login?subdomain=acmecorp" \
  -H "content-type: application/json" \
  -d '{"email":"jo@acme.example","password":"<otp-from-email>"}'
```

**Expected**: `200`, `Set-Cookie: tm_tenant_session=...`, `mustChangePassword: true`. Visiting
`/tenant` in a browser with that cookie redirects to `/set-password`; any other route rejects the
session until it's completed (US5 Acceptance Scenario 3).

## Scenario 3 — Multiple methods enabled, login page reflects both (US1, US3)

As the now-fully-logged-in admin, `PUT /tenant-api/settings/methods?subdomain=acmecorp` with body
`{"methods":["email_password","microsoft"]}`. Revisit `acmecorp.lvh.me:3000/` — both an
email/password form and a stubbed Microsoft option appear (US3 Acceptance Scenario 3, US6).

## Scenario 4 — Failed logins are indistinguishable and rate-limited (US2)

```sh
curl -s -i -X POST "http://acmecorp.lvh.me:3000/tenant-api/login?subdomain=acmecorp" \
  -d '{"email":"jo@acme.example","password":"wrong"}'
curl -s -i -X POST "http://acmecorp.lvh.me:3000/tenant-api/login?subdomain=acmecorp" \
  -d '{"email":"doesnotexist@acme.example","password":"anything"}'
```

**Expected**: byte-identical `401` bodies. Repeat the wrong-password attempt 5 times; the 6th
(even with the correct password) returns `429`.

## Scenario 5 — Forgotten password reset (US4)

```sh
curl -s -X POST "http://acmecorp.lvh.me:3000/tenant-api/forgot-password?subdomain=acmecorp" \
  -d '{"email":"jo@acme.example"}'
```

**Expected**: `200` (identical response even for a nonexistent email — try it), reset email
arrives, completing it via `/tenant-api/reset-password?subdomain=acmecorp` with the emailed token
lets the old password stop working and the new one succeed.

## Scenario 6 — Team member added, gets their own OTP (US5)

`POST /tenant-api/team?subdomain=acmecorp` with a new name/email/role, as the admin. **Expected**:
`201`, new inbox receives an OTP email, same forced-change flow as Scenario 2 for that new account
— and confirm it fails with `409` if the email is already used at `acmecorp` (but would succeed at
a different tenant's subdomain).

## Scenario 7 — Cross-tenant session rejection (FR-011/FR-012)

Log in at `acmecorp.lvh.me:3000`, then present that same session cookie's value at a second,
separately provisioned tenant's subdomain. **Expected**: rejected (`401`) — never treated as valid
there.

## Session-flag re-validation

Run `apps/api`'s test suite (`pnpm --filter api test`) to confirm the RLS-only session-isolation
mechanism (research.md §3) — no manual step needed beyond the automated integration tests, since
this doesn't rely on a special new policy the way Spec 4's subdomain lookup did.
