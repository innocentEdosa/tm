# Quickstart: Course Content

Validates this feature end-to-end via the API directly (no web UI ships in this spec — Constitution
Alignment). Assumes a local dev stack (`docker-compose up`, migrations applied through this spec's own,
plus spec 023's) and an authenticated tenant session holding `course.manage`.

## Prerequisites

1. Migrations applied (`pnpm --filter api db:migrate`), including this feature's two new tables.
2. An existing course (spec 023's `POST /tenant/courses`) to attach modules to — `$COURSE_ID`.
3. A test user holding a role granted `course.manage` (the `hr_admin` role template already has it —
   spec 023 §5).

## Scenario 1 — Build a module structure (User Story 1)

```bash
curl -X POST "$API_BASE/tenant/courses/$COURSE_ID/modules" \
  -H "Cookie: $SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{ "title": "Module 1: Introduction", "description": "Getting started" }'

curl -X POST "$API_BASE/tenant/courses/$COURSE_ID/modules" \
  -H "Cookie: $SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{ "title": "Module 2: Advanced Topics" }'
```
**Expected**: Both `201`. The second module's response has no `position` field exposed to the client,
but a subsequent curriculum read (Scenario 3) shows it after the first.

## Scenario 2 — Add content of each type (User Story 2)

```bash
MODULE_ID="<id from Scenario 1's first module>"

curl -X POST "$API_BASE/tenant/modules/$MODULE_ID/content-items" \
  -H "Cookie: $SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{ "type": "video", "title": "Welcome Video", "payload": { "url": "https://youtube.com/watch?v=example" } }'

curl -X POST "$API_BASE/tenant/modules/$MODULE_ID/content-items" \
  -H "Cookie: $SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{ "type": "article", "title": "Read Me First", "payload": { "body": "Welcome to the course..." } }'

curl -X POST "$API_BASE/tenant/modules/$MODULE_ID/content-items" \
  -H "Cookie: $SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{ "type": "external_import", "title": "Legacy SCORM Module", "payload": { "url": "https://cdn.example.com/scorm/pkg.zip", "sourceType": "scorm" } }'
```
**Expected**: All `201`. A `video` create with no `payload.url`, or an `external_import` create missing
`payload.sourceType`, returns `422`.

## Scenario 3 — Read the full curriculum (User Story 3)

```bash
curl "$API_BASE/tenant/courses/$COURSE_ID/curriculum" -H "Cookie: $SESSION_COOKIE"
```
**Expected**: `200`, an array of modules in creation order, each with its `contentItems` in creation
order (three items under Module 1, none under Module 2).

## Scenario 4 — Reorder and move (User Story 4)

```bash
MODULE_2_ID="<id from Scenario 1's second module>"

# Reorder Module 1's content items — reverse the three:
curl -X POST "$API_BASE/tenant/modules/$MODULE_ID/content-items/reorder" \
  -H "Cookie: $SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{ "contentItemIds": ["<id3>", "<id2>", "<id1>"] }'

# Move the article to Module 2:
ARTICLE_ID="<id2>"
curl -X PATCH "$API_BASE/tenant/content-items/$ARTICLE_ID" \
  -H "Cookie: $SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{ "moduleId": "'"$MODULE_2_ID"'" }'
```
**Expected**: First call → `200`, subsequent curriculum read shows Module 1's items reversed. Second
call → `200`, subsequent curriculum read shows the article under Module 2 (appended last there), no
longer under Module 1.

## Scenario 5 — Delete and cascade (User Story 5)

```bash
curl -X DELETE "$API_BASE/tenant/modules/$MODULE_2_ID" -H "Cookie: $SESSION_COOKIE"
```
**Expected**: `200`. A subsequent curriculum read no longer shows Module 2 — and the article moved
there in Scenario 4 is gone too (cascade delete), not orphaned.

## Scenario 6 — Tenant isolation and permission gating (SC-003, SC-004)

```bash
# As a user in a DIFFERENT tenant, requesting the course's curriculum:
curl "$API_BASE/tenant/courses/$COURSE_ID/curriculum" -H "Cookie: $OTHER_TENANT_SESSION_COOKIE"
# Expected: 404

# As a user holding neither course.view nor course.manage:
curl "$API_BASE/tenant/courses/$COURSE_ID/curriculum" -H "Cookie: $NO_PERMISSION_SESSION_COOKIE"
# Expected: 403
```

## Automated coverage

The scenarios above are each backed by a corresponding integration test under
`apps/api/tests/integration/course-content-*.test.ts` (tasks.md), run via `pnpm --filter api test`,
against a real Postgres connection.
