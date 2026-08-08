# Contract: Course Marketplace Updates API

Delta on top of `specs/029-course-marketplace/contracts/platform-course-authoring-api.md` and
`course-marketplace-api.md`. Only changed/new routes are listed; every other route from 029 is
unchanged.

## Super Admin authoring routes — behavior change only, no shape change

`apps/api/src/platform-courses/platform-course-routes.ts`,
`platform-course-content-routes.ts`, `platform-course-file-routes.ts` — still `requireSuperAdminSession`,
still `fastify.db`, still the same request/response bodies as 029. The only change is removal of the
`409 "frozen"` rejection:

- `PATCH /admin/platform-courses/:id` — no longer 409s for `title`/`categoryName`/`deliveryMode`/
  `duration` once a fulfilled selection exists. Always succeeds (subject to the same field validation as
  before).
- `POST /admin/platform-courses/:id/objectives` (existing route, was never gated) — unchanged.
- `POST /admin/platform-course-modules`, `PATCH .../:id`, `DELETE .../:id`, `POST .../:id/reorder` (and
  the content-item equivalents) — no longer 409 for a course with a fulfilled selection.
- `POST /admin/platform-courses/:id/image`, `POST /admin/platform-course-content-items/:id/attachments`,
  `DELETE /admin/platform-file-attachments/:attachmentId` — no longer 409. The underlying R2 object for
  a course that has ≥1 fulfilled selection is preserved rather than deleted on replace/delete
  (research.md §3) — invisible to the API contract itself (still `200`/`201`, same body shape), but
  callers should not assume a deleted attachment's storage is actually freed once any tenant has cloned
  the course.

Every successful write on a route above now also increments `platform_courses.version` and, if the
course has ≥1 fulfilled selection, triggers the notify routine (below) — not reflected in the response
body of the authoring route itself (Super Admin doesn't need to see tenant-facing version bookkeeping
here); visible only via the tenant-facing routes below.

## `GET /tenant/courses` and `GET /tenant/courses/:courseId` — response gains one field

Existing routes, `apps/api/src/courses/tenant-course-routes.ts`, unchanged auth
(`requireTenantUserSession` + `requirePermission("course.manage")` — same as 029/023). Each course in the
response now includes:

```json
{
  "updateAvailable": false
}
```

`true` when the course has a `fulfilled` `marketplace_selections` row whose `platformCourse.version >
appliedPlatformCourseVersion` and `dismissedPlatformCourseVersion !== platformCourse.version`
(data-model.md derived state); `false` for a tenant-authored course with no marketplace origin, or a
cloned course that's already caught up or already dismissed at the current version.

## `POST /tenant/courses/:courseId/marketplace-update/apply`

New route, same plugin group as the rest of tenant course management. `requireTenantUserSession` +
`requirePermission("course.manage")`.

**Body**: none.

**Response** `200`: the updated course, same shape as `GET /tenant/courses/:courseId`
(`updateAvailable: false` afterward).

**Behavior**: Resolves the tenant's `fulfilled` `marketplace_selections` row for this course. Runs
`applyPlatformCourseUpdateToTenant` (research.md §4, data-model.md) inside one transaction: updates
course metadata/category resolution, reconciles the course image attachment, reconciles modules and
content items by `source_...` id (update-in-place for matches, insert for new, delete for
no-longer-present), rebuilds `courses.outlineOrder`, advances
`applied_platform_course_version` to the platform course's current `version`. Does not touch
`learner_content_progress` at all (FR-007) — surviving content items keep their row id, so existing
progress rows keep resolving without any write to that table.

**Errors**:
- `404` — course doesn't exist, doesn't belong to the caller's tenant, or has no `fulfilled`
  `marketplace_selections` row (not a marketplace-origin course).
- `422` — no update is currently available (`platformCourse.version <= appliedPlatformCourseVersion`) —
  applying is a no-op the API refuses rather than silently succeeding, so a client can't mistake "nothing
  happened" for "update applied."
- `403` — caller lacks `course.manage`.

## `POST /tenant/courses/:courseId/marketplace-update/dismiss`

Same auth as apply.

**Body**: none.

**Response** `200`: the updated course (`updateAvailable: false` afterward, until the next platform
edit).

**Behavior**: Sets `dismissedPlatformCourseVersion = platformCourse.version` (the version current at the
moment of the call) on the tenant's `fulfilled` selection row for this course. No other write.

**Errors**: same `404`/`422`/`403` shape as apply — `422` if there is no outstanding update to dismiss.

## Internal: version-bump-and-notify routine

Not a route — a function, `recordPlatformCourseChange(fastify.db, fastify.pg.pool, platformCourseId,
superAdminId)`, called at the end of every Super Admin authoring route listed above, after its primary
write commits.

1. `UPDATE platform_courses SET version = version + 1, updated_by_super_admin_id = $1, updated_at = now() WHERE id = $2 RETURNING version`.
2. `SELECT * FROM marketplace_selections WHERE platform_course_id = $1 AND status = 'fulfilled'`.
3. For each row where notification is still owed (data-model.md derived state): via
   `withTenantConnection(pool, row.tenantId, ...)`, run the new `listUsersWithPermission(tenantDb,
   "course.manage")` (research.md §7) and call `sendCourseUpdateAvailableEmail(user.email, course.title,
   manageUrl)` (research.md §8) for each result, then `UPDATE marketplace_selections SET
   notified_platform_course_version = $newVersion WHERE id = row.id`.

Email failures never fail the triggering authoring request — the shared `sendMail` wrapper already
guarantees this (research.md §8, mirrors the existing password-reset/invite/tenant-creation email
behavior exactly).
