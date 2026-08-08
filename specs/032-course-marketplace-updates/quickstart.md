# Quickstart: Course Marketplace Updates

Validates the feature end-to-end against a local dev environment (`apps/api` on :3011, `apps/web` on
:3010, per `apps/web/.env`/`apps/api/.env`). Assumes specs/029-course-marketplace is already in place and
working (a Super Admin can author a platform course, a tenant can select/clone it).

## Prerequisites

- Local Postgres running (`docker-compose up` or equivalent) with migration `0106` applied
  (`npm run db:migrate` in `apps/api`, or the project's equivalent drizzle-kit command).
- A Super Admin session (`SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_PASSWORD` from `apps/api/.env`).
- A tenant with at least one user holding `course.manage`, and that tenant's login.
- R2/storage configured (`R2_*` vars set — see the prior investigation in this conversation for the CORS
  caveat on presigned browser uploads; not required for the metadata-only scenarios below).

## Scenario 1 — editing an already-cloned course no longer fails (User Story 1)

1. As Super Admin, create a platform course, add one module and one content item, set it `active`.
2. As the tenant user, select it (free course) via the marketplace — confirm it clones into
   `GET /tenant/courses`.
3. As Super Admin, `PATCH /admin/platform-courses/:id` changing `title` — **expected**: `200`, not the
   old `409 "frozen"`.
4. As Super Admin, add a second module to the same platform course — **expected**: `201`, not `409`.

## Scenario 2 — tenant gets notified and sees the indicator (User Story 2)

1. Continue from Scenario 1 (an edit has already happened).
2. Check the mail sink (or `console.warn`/provider dashboard if `R2_*`/mail vars are unset locally —
   the mailer logs and skips rather than failing) for an email to the tenant user's address referencing
   the course title.
3. As the tenant user, `GET /tenant/courses/:courseId` — **expected**: `"updateAvailable": true`.
4. As Super Admin, edit the platform course again (before the tenant does anything) — **expected**: no
   second email (research.md §5's de-dupe) — verify only one send/log line appears since step 2.

## Scenario 3 — tenant applies the update, progress survives (User Story 3)

1. Before applying, as a learner in the tenant, mark the existing content item's progress
   `in_progress` or `completed` (via the course player, or directly note the `learner_content_progress`
   row and its `content_item_id`).
2. As the tenant user (`course.manage`), `POST /tenant/courses/:courseId/marketplace-update/apply` —
   **expected**: `200`, `updateAvailable: false` in the response.
3. `GET /tenant/courses/:courseId/curriculum` — **expected**: reflects the platform course's current
   title/modules, including the second module added in Scenario 1 step 4.
4. Re-check the learner's `learner_content_progress` row from step 1 by its id — **expected**: unchanged,
   same `content_item_id`, same `status` (SC-004) — because the original content item's tenant-side row
   id was preserved (data-model.md's `source_platform_course_content_item_id` match).

## Scenario 4 — tenant dismisses instead (User Story 4)

1. As Super Admin, make one more edit to the platform course (so `updateAvailable` is true again for
   the tenant that already applied once in Scenario 3).
2. As the tenant user, `POST /tenant/courses/:courseId/marketplace-update/dismiss` — **expected**: `200`,
   `updateAvailable: false`.
3. `GET /tenant/courses/:courseId` — **expected**: title/curriculum completely unchanged from before the
   dismiss (SC-005).
4. As Super Admin, edit the platform course once more — **expected**: `updateAvailable` becomes `true`
   again for that tenant (dismissal was version-scoped, not permanent — Edge Cases).

## Scenario 5 — file replace preserves the un-updated tenant's file (research.md §3)

1. As Super Admin, replace the platform course's image (`POST /admin/platform-courses/:id/image` + the
   presigned-upload flow) on a course with an existing fulfilled selection.
2. As the tenant user who has **not** applied this update, `GET /tenant/courses/:courseId` —
   **expected**: `courseImageUrl` still resolves to the *original* image (their file_attachments row's
   `storage_key` is unchanged).
3. Apply the update (as in Scenario 3) — **expected**: `courseImageUrl` now resolves to the new image.
4. Confirm (via storage bucket listing, or `storage.headObject` on the old key) that the *original*
   image object still exists in R2 — it was never deleted, only superseded (research.md §3's
   object-preservation rule).
