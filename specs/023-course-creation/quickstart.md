# Quickstart: Course Creation

Validates this feature end-to-end via the API directly (no web UI ships in this spec — Constitution
Alignment: Demoable vs. internal). Assumes a local dev stack (`docker-compose up`, migrations applied)
and an authenticated tenant session (see `apps/api/tests/integration/` for the existing session-setup
helper this spec's own tests will reuse).

## Prerequisites

1. Migrations applied (`pnpm --filter api db:migrate`), including this feature's new tables/permissions
   (tasks.md's migration tasks).
2. A tenant provisioned after this feature's migrations land automatically has its six default course
   categories (`course_categories`) — no extra setup step. A tenant provisioned *before* this feature
   shipped needs the backfill migration (data-model.md) applied once.
3. A test user in that tenant holding a role granted `course.manage` (the `hr_admin` role template
   already gets it by default per this feature's seed migration — research.md §5).

## Scenario 1 — Create a course (User Story 1)

```bash
curl -X POST "$API_BASE/tenant/courses" \
  -H "Cookie: $SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{
        "title": "Workplace Communication Essentials",
        "category": "Soft Skills",
        "deliveryMode": "virtual",
        "duration": { "value": 90, "unit": "minutes" },
        "provider": "Acme Learning Co.",
        "cost": 49.99
      }'
```
**Expected**: `201`, `data.status === "draft"`, `data.category.name === "Soft Skills"` (resolved to the
seeded default category, not a newly-created one), `data.createdBy` populated.

## Scenario 2 — Auto-create a category inline (User Story 1, Clarifications)

```bash
curl -X POST "$API_BASE/tenant/courses" \
  -H "Cookie: $SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{
        "title": "Advanced Rigging Safety",
        "category": "Field Operations",
        "deliveryMode": "in_person",
        "duration": { "value": 1, "unit": "days" }
      }'
```
**Expected**: `201`. `GET /tenant/courses/categories` now includes `"Field Operations"` in its list —
created automatically, no separate category-management call was made.

## Scenario 3 — Browse, search, and filter (User Story 2)

```bash
curl "$API_BASE/tenant/courses?search=communication" -H "Cookie: $SESSION_COOKIE"
curl "$API_BASE/tenant/courses?deliveryMode=in_person&status=draft" -H "Cookie: $SESSION_COOKIE"
```
**Expected**: The first call returns only "Workplace Communication Essentials". The second returns only
draft, in-person courses (both scenario-1 and scenario-2 courses appear only if they match).

## Scenario 4 — Edit and un-archive (User Story 3, Clarifications)

```bash
COURSE_ID="<id from Scenario 1>"
curl -X PATCH "$API_BASE/tenant/courses/$COURSE_ID" \
  -H "Cookie: $SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{ "status": "active", "cost": 39.99 }'

curl -X POST "$API_BASE/tenant/courses/$COURSE_ID/archive" -H "Cookie: $SESSION_COOKIE"

curl -X PATCH "$API_BASE/tenant/courses/$COURSE_ID" \
  -H "Cookie: $SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{ "status": "active" }'
```
**Expected**: First call → `200`, `status: "active"`, `cost: "39.99"`. Second call → `200`, `status:
"archived"`, and the course no longer appears in `GET /tenant/courses` (default, unfiltered). Third
call → `200`, `status: "active"` again — un-archiving via the general update endpoint, not a separate
restore action (spec Clarifications).

## Scenario 5 — Tenant isolation and permission gating (SC-003, SC-005)

```bash
# As a user in a DIFFERENT tenant, requesting the course above by id:
curl "$API_BASE/tenant/courses/$COURSE_ID" -H "Cookie: $OTHER_TENANT_SESSION_COOKIE"
# Expected: 404 (never distinguished from "doesn't exist")

# As a user holding neither course.view nor course.manage:
curl "$API_BASE/tenant/courses" -H "Cookie: $NO_PERMISSION_SESSION_COOKIE"
# Expected: 403
```

## Automated coverage

The scenarios above are each backed by a corresponding integration test under
`apps/api/tests/integration/course-*.test.ts` (tasks.md), run via `pnpm --filter api test`, against a
real Postgres connection — no scenario here is "done" until its equivalent automated test passes
(research.md §9).
