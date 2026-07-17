# Quickstart: Super Admin Add Member

Validates the feature end-to-end against a local dev stack. Assumes Spec 020 (Super Admin Tenant
Console) is already implemented and migrated, and there's at least one tenant with one existing role.

## Prerequisites

- Local Postgres running via `docker-compose.yml` (`docker compose up -d postgres`), with migrations
  through `0063` already applied — no new migration in this feature.
- `apps/api/.env` configured per `.env.example`.
- A seeded Super Admin: `pnpm --filter api seed:super-admin` (safe to re-run).
- At least one existing tenant with one custom role (needed since a member cannot be added without a
  valid role).

## Setup

```sh
pnpm --filter api dev   # starts the Fastify server on :3001 — no new migration to apply
pnpm --filter web dev   # starts the Next.js app, proxying /platform-api to the API
```

Log in as the seeded Super Admin and capture the session cookie for the API-level scenarios below:

```sh
curl -s -c cookies.txt -X POST http://localhost:3001/platform/login \
  -H "content-type: application/json" \
  -d '{ "email": "super-admin@example.com", "password": "<seeded password>" }'
```

## Scenario 1 — Add a member successfully (User Story 1, Acceptance Scenario 1)

```sh
TENANT_ID="<existing tenant id>"
ROLE_ID="<existing role id for that tenant>"
curl -s -b cookies.txt -X POST "http://localhost:3001/tenants/$TENANT_ID/members" \
  -H "content-type: application/json" \
  -d "{ \"fullName\": \"New Member\", \"email\": \"new-member@example.com\", \"roleId\": \"$ROLE_ID\" }"
```

**Expected**: `201`, `data.id` and `data.email` present. Confirm via
`GET /tenants/$TENANT_ID/members` (Spec 020) that the new member now appears with
`accountStatus: "invited"`. Confirm (via the mail sink/log used by `apps/api/src/mail`) that one
invite email was sent to `new-member@example.com`.

**Verifies**: FR-001, FR-002, FR-005, FR-006; SC-001, SC-002; Acceptance Scenario 1.

## Scenario 2 — Duplicate email is rejected (Acceptance Scenario 2)

Repeat Scenario 1's exact request a second time.

**Expected**: `409`, `message: "Email already in use at this tenant"`. `GET /tenants/$TENANT_ID/members`
still shows only one member with that email.

**Verifies**: FR-004; SC-004; Acceptance Scenario 2.

## Scenario 3 — Invalid role / inactive department rejected (Acceptance Scenario 3)

```sh
curl -s -b cookies.txt -X POST "http://localhost:3001/tenants/$TENANT_ID/members" \
  -H "content-type: application/json" \
  -d '{ "fullName": "Bad Role", "email": "bad-role@example.com", "roleId": "00000000-0000-0000-0000-000000000000" }'
```

**Expected**: `422`, `message: "Role not found"`. Repeat with a valid `roleId` but a
`departmentId` belonging to a *different* tenant (or an archived one) — expect `422`,
`message: "Department not found or not active"` — and confirm no `users` row was created for either
attempt.

**Verifies**: FR-003; Acceptance Scenario 3; the cross-tenant-isolation regression this feature must
not introduce (research.md §1).

## Scenario 4 — No "Invited By" for a Super-Admin-added member (Acceptance Scenario 4)

In the browser: open that tenant's own Team Directory (its dashboard, not the platform console) and
confirm the member added in Scenario 1 shows a blank/"—" invited-by value, distinct from a member
invited by one of that tenant's own admins.

**Verifies**: FR-007; Acceptance Scenario 4.

## Scenario 5 — Works regardless of tenant status (Acceptance Scenario 7)

Archive the tenant first (`POST /tenants/:id/archive`, Spec 015), then repeat Scenario 1 against the
same `$TENANT_ID` with a new email.

**Expected**: `201`, identical to Scenario 1.

**Verifies**: FR-010 (resolved Clarification); Acceptance Scenario 7.

## Scenario 6 — Forbidden without a Super Admin session (Acceptance Scenario 6)

```sh
curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://localhost:3001/tenants/$TENANT_ID/members" \
  -H "content-type: application/json" \
  -d '{ "fullName": "X", "email": "x@example.com", "roleId": "'"$ROLE_ID"'" }'
```

**Expected**: `401`, no cookie sent. Repeat with a tenant-user session cookie instead — same `401`.

**Verifies**: FR-009; Acceptance Scenario 6.
