# Quickstart: Domain-Based Tenant Routing

Validates the feature end-to-end against a local dev stack. Assumes Specs 1–3's migrations are already
applied — this feature adds one additive migration on top of them, no new tables.

## Prerequisites

- Local Postgres running via `docker-compose.yml` (`docker compose up -d postgres`).
- `apps/api/.env` configured (`DATABASE_URL`, `APP_DATABASE_URL`).
- `apps/web/.env` configured with `API_ORIGIN` (existing) and the new `ROOT_DOMAIN=lvh.me`.
- `lvh.me` requires no hosts-file/DNS edit — it's a public DNS record that always resolves to
  `127.0.0.1` (spec Local Development).

## Setup

```sh
pnpm --filter api db:generate   # generates this feature's migration (rls_tenants_subdomain_lookup)
pnpm --filter api db:migrate    # applies the new RLS policy (no new tables)
pnpm --filter api dev           # starts the Fastify server on :3001
pnpm --filter web dev           # starts the Next.js app on :3000
```

Seed a tenant to test against, using the existing provisioning flow (Spec 2) — no separate seed
mechanism exists or is needed for this feature (spec Assumptions):

```sh
# Log in as Super Admin first (Spec 3), then:
curl -s -X POST http://localhost:3001/provisioning/tenants \
  -H "content-type: application/json" \
  -b "tm_super_admin_session=<value>" \
  -d '{
    "company": {"name":"Acme Corp","subdomain":"acmecorp","primaryContact":{"name":"Jo","email":"jo@acme.test"}},
    "admin": {"fullName":"Jo Admin","email":"jo@acme.test"}
  }'
```

## Scenario 1 — Valid tenant subdomain resolves (User Story 1)

```sh
curl -s -i http://acmecorp.lvh.me:3000/
```

**Expected**: `200`, the minimal tenant landing placeholder ("Welcome to Acme Corp"), not the marketing
page. Confirm a second tenant's subdomain never shows Acme Corp's name (spec SC-001).

## Scenario 2 — Root domain and `/platform/login` isolation (User Story 2)

```sh
curl -s -i http://lvh.me:3000/                       # expect 200, marketing page
curl -s -i http://lvh.me:3000/platform/login          # expect 200, Super Admin login (Spec 3)
curl -s -i http://acmecorp.lvh.me:3000/platform/login # expect 404 — never the login form
curl -s -i http://acmecorp.lvh.me:3000/admin/permissions    # expect 404
curl -s -i http://acmecorp.lvh.me:3000/provisioning/new     # expect 404
```

**Expected**: exactly as annotated above (spec SC-004).

## Scenario 3 — Unclaimed subdomain (User Story 3)

```sh
curl -s -i http://doesnotexist.lvh.me:3000/
```

**Expected**: `404`, no fallback to any tenant or the marketing page (spec SC-002).

## Scenario 4 — Suspended/cancelled tenant (User Story 4)

```sh
# Directly update status for this test (no transition-logic UI exists yet, per Spec 2)
psql "$DATABASE_URL" -c "UPDATE tenants SET status = 'suspended' WHERE subdomain = 'acmecorp';"

curl -s -i http://acmecorp.lvh.me:3000/
```

**Expected**: `200`, the distinct suspended-account page — not a 404, not the tenant landing
placeholder (spec SC-003). Repeat with `status = 'cancelled'` and confirm a distinct cancelled message.

Restore afterward: `UPDATE tenants SET status = 'active' WHERE subdomain = 'acmecorp';`

## Scenario 5 — Reserved subdomains (User Story 5)

```sh
curl -s -i http://admin.lvh.me:3000/
```

**Expected**: `404` — same as an ordinary unclaimed subdomain from the outside, but resolved via the
reserved-word check (no `tenants` query issued — confirm via `apps/api` logs/tests, not observable
from `curl` alone).

```sh
curl -s -X POST http://localhost:3001/provisioning/tenants \
  -H "content-type: application/json" -b "tm_super_admin_session=<value>" \
  -d '{"company":{"name":"Bad Co","subdomain":"admin","primaryContact":{"name":"Jo","email":"jo@bad.test"}},"admin":{"fullName":"Jo","email":"jo@bad.test"}}'
```

**Expected**: `409`, rejected before any tenant record is created (Spec 2, FR-016).

## Case-insensitivity and multi-label checks (Edge Cases)

```sh
curl -s -i http://ACMECorp.lvh.me:3000/          # expect same result as acmecorp.lvh.me
curl -s -i http://foo.acmecorp.lvh.me:3000/      # expect 404 — multi-label, invalid
```
