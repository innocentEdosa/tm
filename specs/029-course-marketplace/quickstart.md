# Quickstart: Course Marketplace

Validates this feature end-to-end. Unlike specs 023–025/027, this feature ships real UI, but every
scenario below is also directly verifiable via the API (contracts/). Assumes a local dev stack, this
spec's migrations applied (on top of specs 023–027's), a Super Admin session cookie
(`$SUPER_ADMIN_SESSION_COOKIE`), and a tenant session (`$SESSION_COOKIE`) for a user holding
`course.manage`.

## Prerequisites

1. Migrations applied (`pnpm --filter api db:migrate`), including the five new tables and the
   `file_attachments_storage_key_unique` drop.
2. A Super Admin account (spec 003) and a tenant user holding `course.manage` (spec 023 §5).

## Scenario 1 — Super Admin builds a platform course (User Stories 1–2)

```bash
curl -X POST "$API_BASE/admin/platform-courses" \
  -H "Cookie: $SUPER_ADMIN_SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{ "title": "Workplace Safety Basics", "categoryName": "Compliance",
       "deliveryMode": "self_paced", "duration": { "value": 30, "unit": "minutes" } }'
# → PLATFORM_COURSE_ID, status: "draft"

curl -X POST "$API_BASE/admin/platform-courses/$PLATFORM_COURSE_ID/modules" \
  -H "Cookie: $SUPER_ADMIN_SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{ "title": "Module 1: Introduction" }'
# → MODULE_ID

curl -X POST "$API_BASE/admin/platform-course-modules/$MODULE_ID/content-items" \
  -H "Cookie: $SUPER_ADMIN_SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{ "type": "video", "title": "Welcome", "payload": { "url": "https://youtube.com/watch?v=example" } }'

curl -X PATCH "$API_BASE/admin/platform-courses/$PLATFORM_COURSE_ID" \
  -H "Cookie: $SUPER_ADMIN_SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{ "status": "active" }'
```
**Expected**: Each `201`/`200`. The course is now `active` and has one module with one content item.

## Scenario 2 — Tenant browses and selects a free course (User Story 3–4)

```bash
curl "$API_BASE/tenant/course-marketplace" -H "Cookie: $SESSION_COOKIE"
# → includes PLATFORM_COURSE_ID, alreadySelected: false

curl "$API_BASE/tenant/course-marketplace/$PLATFORM_COURSE_ID" -H "Cookie: $SESSION_COOKIE"
# → full detail + curriculum outline (1 module, 1 content item)

curl -X POST "$API_BASE/tenant/course-marketplace/$PLATFORM_COURSE_ID/select" \
  -H "Cookie: $SESSION_COOKIE"
# → 201 { "outcome": "cloned", "courseId": "..." }

curl "$API_BASE/tenant/courses/$COURSE_ID" -H "Cookie: $SESSION_COOKIE"
# → the cloned course, in this tenant's own catalog, category "Compliance" auto-created for this tenant

curl -X POST "$API_BASE/tenant/course-marketplace/$PLATFORM_COURSE_ID/select" \
  -H "Cookie: $SESSION_COOKIE"
# → 409 — already selected (FR-009)
```
**Expected**: A new course appears in the tenant's own catalog with matching module/content-item
structure, editable and assignable like any tenant-authored course. Repeating the select is rejected.

## Scenario 3 — Paid course: request, then Super Admin resolves (User Story 5)

```bash
# Super Admin creates a second platform course with cost: 49.00, publishes it — PAID_COURSE_ID

curl -X POST "$API_BASE/tenant/course-marketplace/$PAID_COURSE_ID/select" \
  -H "Cookie: $SESSION_COOKIE"
# → 201 { "outcome": "requested", "selectionId": "..." }

curl "$API_BASE/tenant/courses" -H "Cookie: $SESSION_COOKIE"
# → does NOT yet include a clone of PAID_COURSE_ID

curl "$API_BASE/admin/marketplace-selections" -H "Cookie: $SUPER_ADMIN_SESSION_COOKIE"
# → includes the pending selection, status: "requested"

curl -X POST "$API_BASE/admin/marketplace-selections/$SELECTION_ID/resolve" \
  -H "Cookie: $SUPER_ADMIN_SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{ "decision": "paid" }'
# → 200, status: "fulfilled", clonedCourseId set

curl "$API_BASE/tenant/courses" -H "Cookie: $SESSION_COOKIE"
# → now includes the clone
```
**Expected**: No clone exists until the Super Admin resolves the selection as `paid`; resolving
triggers the identical clone behavior as Scenario 2.

## Scenario 4 — Immutability once cloned (SC-007)

```bash
curl -X DELETE "$API_BASE/admin/platform-course-modules/$MODULE_ID" \
  -H "Cookie: $SUPER_ADMIN_SESSION_COOKIE"
# → 409 — PLATFORM_COURSE_ID has ≥1 fulfilled selection (Scenario 2)
```
**Expected**: Rejected — a platform course's content is frozen once any tenant has cloned it.

## Scenario 5 — Shared storage object, not duplicated (SC-005)

For a platform content item with an uploaded file attached (via
`POST /admin/platform-course-content-items/:id/attachments/upload-url` +
`.../confirm`), after a tenant selects that course, compare `storage_key` between the
`platform_file_attachments` row and the new tenant `file_attachments` row for the cloned content item —
**Expected**: identical `storage_key`; no second object exists in R2.

## UI verification (both surfaces, real browser required)

1. `(platform-shell)/admin/course-marketplace` — create/publish a platform course as Super Admin,
   fetch calls visible in devtools going through `/platform-api/...`, not a direct API origin.
2. `(dashboard-shell)/learning/marketplace` — browse, open detail, select as a tenant user; confirm the
   resulting course appears in the tenant's existing course list UI.
