# Quickstart: Learner Progress & Attempt Tracking

Validates this feature end-to-end via the API directly (no web UI ships in this spec — Constitution
Alignment). Assumes a local dev stack (`docker-compose up`, migrations applied) with an authenticated
tenant session holding `course.view` (or `course.manage`).

## Prerequisites

1. Migrations applied (`pnpm --filter api db:migrate`), including this feature's new
   `learner_content_progress` table.
2. An existing course and content item (spec 023/024) — `$COURSE_ID`, `$CONTENT_ITEM_ID`.
3. Two authenticated tenant sessions: `$SESSION_COOKIE` (a learner holding `course.view`) and
   `$MANAGER_SESSION_COOKIE` (a reviewer holding `course.view` or `course.manage`).

## Scenario 1 — Record initial progress (User Story 1)

```bash
curl -X PUT "$API_BASE/tenant/content-items/$CONTENT_ITEM_ID/progress" \
  -H "Cookie: $SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{ "status": "in_progress", "bookmark": "00:02:15", "sessionTimeSeconds": 135 }'
```
**Expected**: `200`, a new row with `status: "in_progress"`, `bookmark: "00:02:15"`,
`totalTimeSeconds: 135`, `enteredAt` set to now.

## Scenario 2 — Update progress, verify accumulation (User Story 1)

```bash
curl -X PUT "$API_BASE/tenant/content-items/$CONTENT_ITEM_ID/progress" \
  -H "Cookie: $SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{ "status": "completed", "bookmark": "00:10:00", "sessionTimeSeconds": 465 }'
```
**Expected**: `200`, the same row updated in place (not a second row) — `status: "completed"`,
`bookmark: "00:10:00"`, `totalTimeSeconds: 600` (135 + 465), `enteredAt` unchanged from Scenario 1,
`exitedAt`/`updatedAt` advanced.

## Scenario 3 — Read own progress (User Story 2)

```bash
curl "$API_BASE/tenant/content-items/$CONTENT_ITEM_ID/progress" -H "Cookie: $SESSION_COOKIE"

curl "$API_BASE/tenant/courses/$COURSE_ID/progress" -H "Cookie: $SESSION_COOKIE"
```
**Expected**: First call → `200`, the row from Scenario 2. Second call → `200`, an array containing that
same content item's progress (plus any others touched in the course), ordered by curriculum position.

## Scenario 4 — Read progress on an untouched content item (Edge Case)

```bash
curl "$API_BASE/tenant/content-items/$OTHER_CONTENT_ITEM_ID/progress" -H "Cookie: $SESSION_COOKIE"
```
**Expected**: `200` with a synthetic "not started" result (`status: "not_started"`, null fields) — not
`404`, since reading one's own progress never fails just because nothing has been recorded yet.

## Scenario 5 — Reject an inconsistent score (FR-003)

```bash
curl -X PUT "$API_BASE/tenant/content-items/$CONTENT_ITEM_ID/progress" \
  -H "Cookie: $SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{ "status": "completed", "scoreRaw": 150, "scoreMin": 0, "scoreMax": 100 }'
```
**Expected**: `400` — rejected before the row is written or updated (`scoreRaw` outside `[scoreMin,
scoreMax]`).

## Scenario 6 — Manager review across learners (User Story 3)

```bash
curl "$API_BASE/tenant/courses/$COURSE_ID/progress/learners" -H "Cookie: $MANAGER_SESSION_COOKIE"
```
**Expected**: `200`, an array including the learner's row(s) from Scenarios 1-2, identified by learner.

## Scenario 7 — Self-read survives losing `course.view` (SC-005)

```bash
# After revoking course.view from the learner's role:
curl "$API_BASE/tenant/content-items/$CONTENT_ITEM_ID/progress" -H "Cookie: $SESSION_COOKIE"
```
**Expected**: `200` — still returns the learner's own row, unaffected by the permission change.

## Scenario 8 — Tenant isolation and permission gating (SC-002/SC-003)

```bash
# As a user in a DIFFERENT tenant:
curl "$API_BASE/tenant/content-items/$CONTENT_ITEM_ID/progress" -H "Cookie: $OTHER_TENANT_SESSION_COOKIE"
# Expected: 404

# As a user holding neither course.view nor course.manage, attempting to write:
curl -X PUT "$API_BASE/tenant/content-items/$CONTENT_ITEM_ID/progress" \
  -H "Cookie: $NO_PERMISSION_SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{ "status": "in_progress" }'
# Expected: 403

# As a user holding neither permission, attempting the manager review route:
curl "$API_BASE/tenant/courses/$COURSE_ID/progress/learners" -H "Cookie: $NO_PERMISSION_SESSION_COOKIE"
# Expected: 403
```

## Automated coverage

The scenarios above are each backed by a corresponding integration test under
`apps/api/tests/integration/progress-*.test.ts` (tasks.md), run via `pnpm --filter api test` — no
external service dependency exists in this spec, so every scenario runs against real local Postgres only
(no recording fixture needed, unlike spec 025).
