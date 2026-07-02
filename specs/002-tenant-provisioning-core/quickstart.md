# Quickstart: Tenant Provisioning Core

Validates the feature end-to-end against a local dev stack. Assumes Spec 1 (Roles & Permissions
Model) is already migrated and seeded — this feature adds migrations on top of it, it does not
replace anything.

## Prerequisites

- Local Postgres running via `docker-compose.yml` (`docker compose up -d postgres`), with Spec 1's
  migrations (`0000`–`0008`) already applied.
- `apps/api/.env` configured per `.env.example` (`DATABASE_URL`, `APP_DATABASE_URL`,
  `PLATFORM_READER_DATABASE_URL`).
- A seeded Super Admin user with the `provision_tenant` permission — the dev auth stub
  (`x-dev-user-id` header, `NODE_ENV=development` only) stands in for real auth (Spec 3 doesn't exist
  yet).

## Setup

```sh
pnpm --filter api db:generate   # generates this feature's migration from the Drizzle schema
pnpm --filter api db:migrate    # applies 0009+ (tenants/departments/users tables, RLS, seeds, FK)
pnpm --filter api dev           # starts the Fastify server on :3001
```

## Scenario 1 — Happy path: full provisioning in one request (User Stories 1–3)

```sh
curl -s -X POST http://localhost:3001/provisioning/tenants \
  -H "content-type: application/json" \
  -H "x-dev-user-id: $DEV_SUPER_ADMIN_USER_ID" \
  -d '{
    "company": {
      "name": "Acme Corp",
      "subdomain": "acme",
      "industry": "Manufacturing",
      "primaryContact": { "name": "Jordan Lee", "email": "jordan.lee@acme.example" }
    },
    "admin": { "fullName": "Priya Shah", "email": "priya.shah@acme.example" }
  }'
```

**Expected**: `201`, response body per contracts/provision-tenant-api.md, `tenant.status === "trial"`,
`departments` contains the six default templates (research.md §5), `admin.roleAssigned === "HR/L&D Admin"`.

**Verifies**: FR-001–FR-004, FR-006, FR-008–FR-010; SC-001, SC-002, SC-006.

## Scenario 2 — Customized departments in the same request (User Story 3)

Repeat Scenario 1 with a different `subdomain` and an explicit `departments` array (e.g. rename one
default, drop another, add a new one). **Expected**: `201`, `departments` in the response exactly
matches the submitted list, not the defaults.

**Verifies**: FR-007; SC-004.

## Scenario 3 — Duplicate subdomain rejected (Edge Cases)

Repeat Scenario 1's request body unchanged (same `subdomain`). **Expected**: `409`,
`"Subdomain already in use"`; confirm via `psql` that no second `tenants` row with that subdomain
exists.

**Verifies**: FR-002.

## Scenario 4 — Cross-tenant isolation (Tenant Isolation)

Run Scenario 1 twice with two different subdomains, producing `tenantId`s `A` and `B`. Using each
tenant's own admin session (`x-dev-tenant-id`), confirm `GET`-style reads through `request.tenantDb`
for departments/users under tenant `A` never return tenant `B`'s rows, and vice versa.

**Verifies**: FR-005; SC-003.

## Scenario 5 — Missing `hr_admin` template fails closed (FR-014)

In a disposable test database, delete the `hr_admin` row from `role_templates` before calling the
endpoint. **Expected**: `500`, `"Provisioning is misconfigured..."`; confirm via `psql` that no
`tenants` row was created at all (whole transaction rolled back).

**Verifies**: FR-013, FR-014; SC-005.

## Scenario 6 — Non-Super-Admin caller rejected

Repeat Scenario 1 with `x-dev-user-id` set to a user who is not the platform Super Admin (or omit the
header entirely). **Expected**: `403`.

**Verifies**: research.md §7 (access control).

## Automated coverage

The scenarios above are exercised as Vitest integration tests under `apps/api/tests/integration/`,
following the existing pattern in `apps/api/tests/integration/seed-default-roles.test.ts` and
`apps/api/tests/integration/rls-cross-tenant.test.ts` — real Postgres connection, no mocks (same
rationale as Spec 1's plan.md **Testing** section: RLS enforcement cannot be verified as "actually
blocked" against a mock).
