# Quickstart: Super Admin Tenant Console

Validates the feature end-to-end against a local dev stack. Assumes Super Admin Authentication (003),
Tenant Management (015), Department Management (009), Roles Management UI (011), and Team Member
Directory (012) are already migrated and have at least one tenant with departments, roles, and members
to inspect.

## Prerequisites

- Local Postgres running via `docker-compose.yml` (`docker compose up -d postgres`), with migrations
  through `0056` already applied.
- `apps/api/.env` configured per `.env.example`.
- A seeded Super Admin: `pnpm --filter api seed:super-admin` (safe to re-run).
- At least one existing tenant with: one department, one custom role, and at least one member with an
  active session (log in as that member once via `/tenant-api/tenant-auth/login` to create a session
  to later verify gets revoked).

## Setup

```sh
pnpm --filter api db:generate   # generates this feature's migrations from the amended Drizzle schema
pnpm --filter api db:migrate    # applies 0057+ (member_action_log table + grants lock, five new
                                 # super_admin_full_access RLS policies)
pnpm --filter api dev           # starts the Fastify server on :3001
pnpm --filter web dev           # starts the Next.js app on :3000 (proxies /platform-api to :3001)
```

Log in as the seeded Super Admin and capture the session cookie for the API-level scenarios below:

```sh
curl -s -c cookies.txt -X POST http://localhost:3001/platform/login \
  -H "content-type: application/json" \
  -d '{ "email": "super-admin@example.com", "password": "<seeded password>" }'
```

## Scenario 1 — View a tenant's full detail (User Story 1)

```sh
TENANT_ID="<existing tenant id>"
curl -s -b cookies.txt "http://localhost:3001/tenants/$TENANT_ID"
curl -s -b cookies.txt "http://localhost:3001/tenants/$TENANT_ID/departments"
curl -s -b cookies.txt "http://localhost:3001/tenants/$TENANT_ID/roles"
curl -s -b cookies.txt "http://localhost:3001/tenants/$TENANT_ID/members"
```

**Expected**: All four `200`, each returning only `$TENANT_ID`'s own data. If a second tenant exists,
repeat with its id and confirm the two responses never mix rows — this is the scenario that would
silently fail (returning every tenant's rows merged together) if any handler queries via
`request.superAdminDb` without the explicit `tenant_id` filter (research.md §1, plan.md Summary).

Then, in the browser: log in as the Super Admin at `/platform/login`, open Tenants, and select
"Manage" on a tenant row. Confirm the URL is `/tenants/<id>` on the platform's own origin (never a
tenant subdomain) and that Company/Departments/Roles/Members all render.

**Verifies**: FR-001 through FR-006, FR-012; SC-001; Acceptance Scenarios 1–2 of User Story 1.

## Scenario 2 — Access denied without a Super Admin session (FR-007, Acceptance Scenario 3)

```sh
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3001/tenants/$TENANT_ID/members"
```

**Expected**: `401`, no cookie sent. Repeat with a tenant-user session cookie instead of a Super Admin
one — same `401`.

**Verifies**: FR-007; Acceptance Scenario 3 of both user stories.

## Scenario 3 — Reset a member's password without email (User Story 2)

```sh
MEMBER_ID="<existing member id in that tenant>"
curl -s -b cookies.txt -X POST \
  "http://localhost:3001/tenants/$TENANT_ID/members/$MEMBER_ID/reset-password"
```

**Expected**: `200`, `data.generatedPassword` is a non-empty string. No email is sent (check the mail
sink/log used by `apps/api/src/mail` — it must show no new message for this action).

Then:
1. Attempt to use the member's *previous* session cookie/token against any tenant-authenticated route
   — it must now fail (session revoked).
2. Log in as that member via `/tenant-api/tenant-auth/login` using the returned
   `generatedPassword` — login succeeds, and the member is **not** redirected to a forced
   change-password screen (spec Clarifications: not forced).
3. Query `member_action_log` directly (`psql`) and confirm one new row with the correct `tenant_id`,
   `member_id`, `super_admin_id`, and `action = 'password_reset'`.

**Verifies**: FR-008, FR-009, FR-010, FR-011; SC-002, SC-003, SC-004; all Acceptance Scenarios of User
Story 2.

## Scenario 4 — Console works regardless of tenant status (FR-013)

Archive the test tenant first (`POST /tenants/:id/archive`, Tenant Management 015), then repeat
Scenarios 1 and 3 against the same `$TENANT_ID`.

**Expected**: Every read and the password-reset write still succeed identically — no `409`/`403`
introduced by the tenant's archived status.

**Verifies**: FR-013 (resolved Clarification); the "Fully available regardless of status" answer.

## Scenario 5 — No edit capability leaks into the console (FR-014)

In the browser, on `/tenants/<id>`, confirm the Departments, Roles, and Members sections expose no
create/edit/delete affordance anywhere — only the password-reset action on a member row.

**Verifies**: FR-014; Acceptance Scenario 4 of User Story 1.
