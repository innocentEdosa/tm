# Quickstart: Super Admin Edit Tenant Configuration

Validates the feature end-to-end against a local dev stack. Assumes Specs 020/021 are already
implemented, and there's at least one tenant with one existing member, one custom role, and one
department.

## Prerequisites

- Local Postgres running via `docker-compose.yml` (`docker compose up -d postgres`), with migrations
  through the two new ones this feature adds (`tenant_config_action_log` table + grants) applied — no
  migration needed for `roles`/`role_permissions`/`departments`/`form_fields` (already covered,
  research.md §1/§2).
- `apps/api/.env` configured per `.env.example`.
- A seeded Super Admin: `pnpm --filter api seed:super-admin` (safe to re-run).
- At least one tenant with: one custom (non-system) role, one department, and one member.

## Setup

```sh
pnpm --filter api dev   # starts the Fastify server on :3001
pnpm --filter web dev   # starts the Next.js app, proxying /platform-api to the API
```

Log in as the seeded Super Admin and capture the session cookie for the API-level scenarios below:

```sh
curl -s -c cookies.txt -X POST http://localhost:3001/platform/login \
  -H "content-type: application/json" \
  -d '{ "email": "super-admin@example.com", "password": "<seeded password>" }'
```

## Scenario 1 — Edit an existing member's role and department (US1, Acceptance Scenario 1)

```sh
TENANT_ID="<existing tenant id>"
MEMBER_ID="<existing member id in that tenant>"
NEW_ROLE_ID="<a different existing role id, same tenant>"
curl -s -b cookies.txt -X PATCH "http://localhost:3001/tenants/$TENANT_ID/members/$MEMBER_ID" \
  -H "content-type: application/json" \
  -d "{ \"roleId\": \"$NEW_ROLE_ID\" }"
```

**Expected**: `200`, `data.roleId` reflects the new role. Confirm via that tenant's own Team
Directory (its dashboard, not the platform console) that the change is visible there too.

**Verifies**: FR-003, FR-010; SC-001, SC-005; US1 Acceptance Scenarios 1, 4.

## Scenario 2 — Cannot archive a department leader (US1, Acceptance Scenario 3)

```sh
LEADER_ID="<member id who is a department's managerId or assistantManagerId>"
curl -s -b cookies.txt -X PATCH "http://localhost:3001/tenants/$TENANT_ID/members/$LEADER_ID" \
  -H "content-type: application/json" \
  -d '{ "archived": true }'
```

**Expected**: `422`, "reassign that leadership role first" message. `GET /tenants/$TENANT_ID/members`
still shows the member as not archived.

**Verifies**: FR-003; US1 Acceptance Scenario 3.

## Scenario 3 — Create and edit a role, including system-role protection (US2)

```sh
curl -s -b cookies.txt -X POST "http://localhost:3001/tenants/$TENANT_ID/roles" \
  -H "content-type: application/json" \
  -d '{ "name": "Console-Created Role", "permissionKeys": ["team.view.department"] }'
# → 201, capture data.id as $NEW_ROLE

curl -s -b cookies.txt -X PATCH "http://localhost:3001/tenants/$TENANT_ID/roles/$NEW_ROLE" \
  -H "content-type: application/json" \
  -d '{ "description": "Edited via console" }'
# → 200

SYSTEM_ROLE_ID="<a system/default role id for this tenant, isSystem: true from GET /tenants/:id/roles>"
curl -s -b cookies.txt -X PATCH "http://localhost:3001/tenants/$TENANT_ID/roles/$SYSTEM_ROLE_ID" \
  -H "content-type: application/json" \
  -d '{ "name": "Attempted Rename" }'
```

**Expected**: The first two calls succeed (`201`, `200`). The third returns `403`, "System roles
cannot be modified." — and `GET /tenants/:id/roles` shows the system role's name unchanged.

**Verifies**: FR-004, FR-005, FR-010; SC-002, SC-006; US2 Acceptance Scenarios 1, 2, 3.

## Scenario 4 — Cannot delete a role with members assigned (US2, Acceptance Scenario 4)

```sh
ROLE_WITH_MEMBERS="<a role id with at least one member assigned>"
curl -s -b cookies.txt -X DELETE "http://localhost:3001/tenants/$TENANT_ID/roles/$ROLE_WITH_MEMBERS"
```

**Expected**: `409`, "reassign them before deleting" message. The role still exists afterward.

**Verifies**: FR-005; US2 Acceptance Scenario 4.

## Scenario 5 — Create and edit a department, hierarchy cap enforced (US3)

```sh
curl -s -b cookies.txt -X POST "http://localhost:3001/tenants/$TENANT_ID/departments" \
  -H "content-type: application/json" \
  -d '{ "name": "Console-Created Dept" }'
# → 201, capture data.id as $NEW_DEPT

curl -s -b cookies.txt -X PATCH "http://localhost:3001/tenants/$TENANT_ID/departments/$NEW_DEPT" \
  -H "content-type: application/json" \
  -d '{ "description": "Edited via console" }'
# → 200
```

Then, with a 3-level-deep chain already existing under a different root, attempt to nest a 4th level
under it via `parentDepartmentId` — expect `422`, "Departments can only be nested up to 3 levels
deep."

**Verifies**: FR-007, FR-010; SC-003; US3 Acceptance Scenarios 1, 2, 3.

## Scenario 6 — Create, edit, and archive a tenant-scoped custom field (US4)

```sh
curl -s -b cookies.txt -X POST "http://localhost:3001/tenants/$TENANT_ID/custom-fields" \
  -H "content-type: application/json" \
  -d '{ "formKey": "member", "label": "Console Field", "fieldType": "text" }'
# → 201, capture data.id as $NEW_FIELD

curl -s -b cookies.txt -X PATCH "http://localhost:3001/tenants/$TENANT_ID/custom-fields/$NEW_FIELD" \
  -H "content-type: application/json" \
  -d '{ "archived": true }'
# → 200
```

Confirm (in the browser, on that tenant's own member form) that "Console Field" no longer renders
after archiving, but that any value already saved against it (if one was set beforehand) is still
present in `custom_field_values` — check via a direct query or the existing
`GET /tenant/custom-field-values` route.

**Verifies**: FR-008, FR-009, FR-010; SC-004; US4 Acceptance Scenarios 1, 2, 4.

## Scenario 7 — A global field is never reachable through this console (US4, Acceptance Scenario 5)

```sh
GLOBAL_FIELD_ID="<a form_fields id with tenant_id IS NULL, if one exists in this environment>"
curl -s -b cookies.txt -X PATCH "http://localhost:3001/tenants/$TENANT_ID/custom-fields/$GLOBAL_FIELD_ID" \
  -H "content-type: application/json" \
  -d '{ "label": "Attempted Edit" }'
```

**Expected**: `404` — the same as any nonexistent id, not a distinguishable error (spec FR-009,
research.md §2: this route's own tenant-id filter is what makes the global row invisible, RLS alone
would have allowed it through).

**Verifies**: FR-009; SC-006; US4 Acceptance Scenario 5.

## Scenario 8 — Forbidden without a Super Admin session

```sh
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH "http://localhost:3001/tenants/$TENANT_ID/members/$MEMBER_ID" \
  -H "content-type: application/json" \
  -d '{ "fullName": "X" }'
```

**Expected**: `401`, no cookie sent. Repeat against every new route in this feature with a
tenant-user session cookie instead of a Super Admin one — same rejection every time.

**Verifies**: FR-011.

## Scenario 9 — Works regardless of tenant status

Archive the tenant first (`POST /tenants/:id/archive`, Spec 015), then repeat Scenario 1 (member
edit) against the same `$TENANT_ID`.

**Expected**: `200`, identical to Scenario 1.

**Verifies**: FR-012.
