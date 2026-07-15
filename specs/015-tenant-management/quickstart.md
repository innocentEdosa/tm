# Quickstart: Tenant Management

Validates the feature end-to-end against a local dev stack. Assumes Tenant Provisioning Core, Super
Admin Authentication, and Tenant Authentication Configuration are already migrated — this feature adds
migrations on top of them.

## Prerequisites

- Local Postgres running via `docker-compose.yml` (`docker compose up -d postgres`), with migrations
  through `0052` already applied.
- `apps/api/.env` configured per `.env.example`.
- A seeded Super Admin: `pnpm --filter api seed:super-admin` (safe to re-run).
- At least one existing tenant to act on — provision one via `POST /provisioning/tenants`
  (contracts/provision-tenant-api.md, Tenant Provisioning Core) if none exists yet.

## Setup

```sh
pnpm --filter api db:generate   # generates this feature's migration from the amended Drizzle schema
pnpm --filter api db:migrate    # applies 0053+ (tenants columns, both super_admin_full_access
                                 # policies, tenant_action_log table)
pnpm --filter api dev           # starts the Fastify server on :3001
```

Log in as the seeded Super Admin and capture the session cookie for the scenarios below:

```sh
curl -s -c cookies.txt -X POST http://localhost:3001/platform/login \
  -H "content-type: application/json" \
  -d '{ "email": "super-admin@example.com", "password": "<seeded password>" }'
```

## Scenario 1 — List every tenant (User Story 1)

```sh
curl -s -b cookies.txt http://localhost:3001/tenants
```

**Expected**: `200`, `data.tenants` includes every previously provisioned tenant with `name`,
`subdomain`, `status`, `isArchived: false`, `isPendingDeletion: false`, `primaryContactEmail`,
`createdAt`.

**Verifies**: FR-001, FR-002 (with a valid Super Admin cookie); SC-001. This is also the scenario that
would fail with zero rows before this feature's `super_admin_full_access` RLS policy exists
(research.md §8) — if this returns an empty list despite tenants existing in the database, the RLS
migration didn't apply.

## Scenario 2 — Access denied without a Super Admin session (FR-002, spec Acceptance Scenario 3)

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/tenants
```

**Expected**: `401`, no cookie sent. Repeat with a tenant-user session cookie instead of a Super Admin
one (log in via `/tenant/auth/login` for any seeded tenant user) — same `401`.

**Verifies**: FR-002.

## Scenario 3 — Edit a tenant's details, including a subdomain change (User Story 2)

```sh
TENANT_ID="<id from Scenario 1>"
curl -s -b cookies.txt -X PATCH "http://localhost:3001/tenants/$TENANT_ID" \
  -H "content-type: application/json" \
  -d '{ "subdomain": "acme-renamed", "primaryContact": { "email": "new-contact@acme.example" } }'
```

**Expected**: `200`, response reflects the new subdomain and the list from Scenario 1 shows it too.
Repeat with a `subdomain` already used by another tenant (or a reserved word like `www`) — **expected**:
`409` with the same message shape as `POST /provisioning/tenants`'s own subdomain rejection.

**Verifies**: FR-005, FR-006; SC-003, SC-005.

## Scenario 4 — Archive, confirm access is blocked, then reactivate (User Story 3)

```sh
curl -s -b cookies.txt -X POST "http://localhost:3001/tenants/$TENANT_ID/archive"
```

**Expected**: `200`, `isArchived: true`. Then, as that tenant's own user (a session obtained before the
archive call), attempt any authenticated tenant request — **expected**: rejected immediately (FR-007;
SC-007), not merely on next login. Re-run the archive call a second time — **expected**: `200`, same
no-op result (FR-009). Then:

```sh
curl -s -b cookies.txt -X POST "http://localhost:3001/tenants/$TENANT_ID/reactivate"
```

**Expected**: `200`, `isArchived: false`; the previously-archived tenant's departments/users/records are
unchanged (SC-004).

**Verifies**: FR-007, FR-008, FR-009; SC-007.

## Scenario 5 — Downgrade, then attempt to downgrade again (User Story 4)

Requires a tenant currently at `active` status (edit via direct DB update if none exists yet, since no
route in this codebase sets `active` today outside this feature — Tenant Provisioning Core only ever
creates `trial`).

```sh
curl -s -b cookies.txt -X POST "http://localhost:3001/tenants/$TENANT_ID/downgrade"
curl -s -b cookies.txt -X POST "http://localhost:3001/tenants/$TENANT_ID/downgrade"
```

**Expected**: First call `200`, `status: "trial"`. Second call `409` (already at the lowest reachable
status for this action).

**Verifies**: FR-010, FR-011.

## Scenario 6 — Delete with confirmation, recover within the grace period (User Story 5)

```sh
curl -s -b cookies.txt -X POST "http://localhost:3001/tenants/$TENANT_ID/delete" \
  -H "content-type: application/json" \
  -d '{ "confirmTenantName": "wrong name" }'
# expect 400

curl -s -b cookies.txt -X POST "http://localhost:3001/tenants/$TENANT_ID/delete" \
  -H "content-type: application/json" \
  -d '{ "confirmTenantName": "<exact current tenant name>" }'
# expect 200, isPendingDeletion: true

curl -s -b cookies.txt "http://localhost:3001/tenants"
# expect the tenant absent from the default list, or present with isPendingDeletion: true per contract

curl -s -b cookies.txt -X POST "http://localhost:3001/tenants/$TENANT_ID/recover"
# expect 200, isPendingDeletion: false, all prior data intact
```

**Verifies**: FR-013, FR-014, FR-015, FR-015a; SC-006, SC-008.

## Scenario 7 — Purge after the grace period elapses (FR-015b)

```sh
# In a test DB only: manually backdate deletion_purge_at into the past for the target tenant, then:
pnpm --filter api tsx scripts/purge-deleted-tenants.ts
curl -s -b cookies.txt "http://localhost:3001/tenants/$TENANT_ID"
# expect 404 — permanently removed
```

**Verifies**: FR-015b.
