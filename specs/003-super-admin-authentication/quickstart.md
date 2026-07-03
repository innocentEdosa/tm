# Quickstart: Super Admin Authentication

Validates the feature end-to-end against a local dev stack. Assumes Specs 1 and 2's migrations are
already applied — this feature adds new, independent tables on top of them.

## Prerequisites

- Local Postgres running via `docker-compose.yml` (`docker compose up -d postgres`).
- `apps/api/.env` configured (`DATABASE_URL`, `APP_DATABASE_URL`).

## Setup

```sh
pnpm --filter api db:generate   # generates this feature's migration from the Drizzle schema
pnpm --filter api db:migrate    # applies the new tables + grants
pnpm --filter api seed:super-admin   # bootstrap the first Super Admin (contracts/seed-super-admin-script.md)
pnpm --filter api dev           # starts the Fastify server on :3001
pnpm --filter web dev           # starts the Next.js app on :3000
```

## Scenario 1 — Bootstrap and log in (User Story 1)

```sh
SUPER_ADMIN_EMAIL=operator@handiwoker.example SUPER_ADMIN_NAME='Jordan Lee' \
  SUPER_ADMIN_PASSWORD='correct horse battery staple' \
  pnpm --filter api seed:super-admin

curl -s -i -X POST http://localhost:3001/platform/login \
  -H "content-type: application/json" \
  -d '{"email":"operator@handiwoker.example","password":"correct horse battery staple"}'
```

**Expected**: `200`, a `Set-Cookie: tm_super_admin_session=...` header, response body with the Super
Admin's `id`/`email`/`name` (no token in the body). Save the cookie and call:

```sh
curl -s -b "tm_super_admin_session=<value-from-above>" http://localhost:3001/platform/me
```

**Expected**: `200`, `data.isSuperAdminFlagSet === true`.

Or, via the browser: visit `http://localhost:3000/platform/login`, submit the same credentials, land
on `http://localhost:3000/platform` showing the confirmation.

**Verifies**: FR-001–FR-006, FR-012, FR-014–FR-016; SC-001.

## Scenario 2 — Re-running the seed script is a no-op

Repeat the `seed:super-admin` command from Scenario 1 without `ALLOW_ADDITIONAL_SUPER_ADMIN`.

**Expected**: exits `0`, prints that a Super Admin already exists, makes no database changes. Confirm
via `psql`: `SELECT count(*) FROM super_admins;` is unchanged.

**Verifies**: FR-015; SC-005.

## Scenario 3 — Session-type rejection (User Story 2)

Using the Super Admin session cookie from Scenario 1, call any tenant-scoped route (e.g.
`GET /admin/permissions` from Spec 1) — it must not treat the Super Admin cookie as a tenant session
(it simply won't be recognized at all, since tenant auth reads a completely different mechanism).
Conversely, calling `GET /platform/me` with the Spec 1 dev-auth-stub headers (`x-dev-user-id`) instead
of the Super Admin cookie must return `401`.

**Verifies**: FR-007; SC-002.

## Scenario 4 — Failed login: no enumeration, rate-limited (User Story 3)

```sh
# Wrong password for a real account:
curl -s -o /tmp/wrong-password.json -w "%{http_code}\n" -X POST http://localhost:3001/platform/login \
  -H "content-type: application/json" \
  -d '{"email":"operator@handiwoker.example","password":"wrong"}'

# Unknown email entirely:
curl -s -o /tmp/unknown-email.json -w "%{http_code}\n" -X POST http://localhost:3001/platform/login \
  -H "content-type: application/json" \
  -d '{"email":"nobody@handiwoker.example","password":"wrong"}'

diff /tmp/wrong-password.json /tmp/unknown-email.json   # expect no difference
```

**Expected**: both `401`, identical response bodies. Then repeat the wrong-password request 5 times in
a row and confirm the 6th attempt (even with the *correct* password) returns `429` until the cool-down
elapses.

**Verifies**: FR-008, FR-009; SC-003, SC-004.

## Scenario 5 — Logout invalidates the session

```sh
curl -s -i -b "tm_super_admin_session=<value>" -X POST http://localhost:3001/platform/logout
curl -s -o /dev/null -w "%{http_code}\n" -b "tm_super_admin_session=<value>" http://localhost:3001/platform/me
```

**Expected**: logout returns `204`; the follow-up `GET /platform/me` with the same (now-revoked)
cookie returns `401`.

**Verifies**: FR-011.

## Automated coverage

The scenarios above are exercised as Vitest integration tests under `apps/api/tests/integration/`,
following the existing pattern (real Postgres connection, no mocks) established by Specs 1 and 2.
