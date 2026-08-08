# Research: Course Marketplace Updates

All unknowns below were resolved by reading the current implementation of specs/029-course-marketplace
and its dependencies (specs/016, specs/019, specs/025), not by external research — this is an extension
of existing, working code, not a new technology area.

## 1. Where the current freeze is enforced (what has to change)

**Decision**: Three independent enforcement points must all be relaxed, not one:

- `apps/api/src/course-marketplace/platform-course-immutability.ts` — `platformCourseHasFulfilledSelection(db, platformCourseId)`, the single shared predicate (queries `marketplace_selections` for any `status = 'fulfilled'` row). This function itself is **kept** — it becomes the trigger for "notify tenants" instead of the trigger for "reject the request."
- `apps/api/src/platform-courses/platform-course-content-routes.ts:69-82` — a local `rejectIfImmutable` gating all 8 curriculum-mutation routes (module create/update/delete/reorder, content-item create/update/delete/reorder). **Removed** (call sites deleted, not the function renamed — nothing else needs a 409 here anymore).
- `apps/api/src/platform-courses/platform-course-file-routes.ts:87-96` — a second, separately-duplicated copy of the same `rejectIfImmutable`, gating course-image upload, content-item attachment create, and the generic attachment delete route. **Removed** at each of those three call sites, but the underlying object-preservation behavior (§3 below) is added in its place.
- `apps/api/src/platform-courses/platform-course-routes.ts:14-16,176-184` — a narrower `IMMUTABLE_ONCE_CLONED_FIELDS` list (`title`, `categoryName`, `deliveryMode`, `duration`) gating only the course-level PATCH. **Removed** — every platform-course field becomes editable unconditionally (`description`/`provider`/`cost`/`status` were already unconditionally editable; this spec makes the previously-frozen four fields the same).

**Rationale**: The freeze was never one central gate — spec 029 applied the same predicate at three separate layers (course metadata, curriculum, files) with duplicated logic. Removing "the freeze" means removing all three call sites; leaving any one in place would silently reintroduce partial immutability.

**Alternatives considered**: Keep `rejectIfImmutable` and add a Super Admin "force edit anyway" override. Rejected — the feature request is to remove the restriction outright, not to add a bypass for it; an override adds a second code path with the same content this spec's version/notify machinery already exists to handle safely.

## 2. Versioning granularity

**Decision**: One integer counter, `platform_courses.version`, incremented by exactly 1 on every
successful write that changes what a tenant clone would receive: course metadata PATCH (including the
`/objectives` sub-route — informational fields are still content a tenant might want to know changed),
module/content-item create/update/delete/reorder, and course-image or content-item-attachment
confirm/delete (not the initial presigned-URL request — a `pending` attachment nobody has finished
uploading is not yet a real change).

**Rationale**: Spec's own Assumptions section states a single course-level counter (not per-module or
per-content-item, not a full diff/changelog) is sufficient — this matches. A single `UPDATE ... SET
version = version + 1` is one extra statement per existing mutating route; no new infrastructure.

**Alternatives considered**: `updated_at` timestamp comparison instead of an integer counter. Rejected —
timestamps can collide at the same millisecond, don't survive being copied around, and there's no
protection against clock skew across the API instance and Postgres if a client-side comparison were ever
needed; a monotonically-increasing integer, mutated only inside one transaction per request, is simpler
to reason about atomically.

## 3. File-object preservation once clones exist

**Decision**: Once `platformCourseHasFulfilledSelection` is true for a course, no route belonging to
that course may call `storage.deleteObject()` on any of its attachments' R2 objects, ever again — only
the `platform_file_attachments` **row** may be deleted (or superseded by a new row); the underlying
object is left in place permanently. This applies to:
- The course-image "replace" flow (`deleteAllAttachmentsForPlatformEntity`, called from the image-upload
  route before inserting the new attachment) — gains a `preserveObjects: boolean` parameter.
- The generic `DELETE /admin/platform-file-attachments/:attachmentId` route.
- The module/content-item delete cascades in `platform-course-content-routes.ts` (which also call
  `deleteAllAttachmentsForPlatformEntity`).

**Rationale**: A tenant clone's `file_attachments.storage_key` is a plain string copied at clone time
(spec 029's shared-storage design), not a foreign key — Postgres has no way to protect that object from
deletion on the platform side. The only way to guarantee FR-002 ("tenants who have not accepted an
update must keep seeing their originally-cloned file untouched — never have it change out from under
them silently") is for the platform side to never delete an object once any tenant might be pointing at
it. Since there is no cheap, reliable way to know from the platform side alone whether every tenant clone
has since moved past a given object (that would require a cross-tenant scan), the safe rule is
unconditional: once ≥1 fulfilled selection has ever existed, objects accumulate rather than get deleted.

**Consequence flagged, not silently absorbed**: this means R2 storage for a frequently-edited,
widely-cloned platform course's files grows monotonically — old, no-longer-referenced-by-anyone objects
are never garbage-collected by this feature. Garbage collection (e.g., a periodic job that finds
platform attachment objects no tenant's `file_attachments` row references anymore) is explicitly
out-of-scope future work, consistent with the spec's "no diff/changelog, no partial updates" minimalism
and not called for by any functional requirement.

**Alternatives considered**: Reference-count each object across all tenant `file_attachments` rows before
deleting. Rejected as disproportionate — would require a cross-tenant query from a Super-Admin-scoped
connection (RLS complications, see §6) just to delete-object-cleanup, for a feature whose spec explicitly
prefers the simpler option ("Keep this proportional") wherever one exists.

## 4. Matching tenant content across versions (why plain "overwrite" isn't enough)

**Decision**: Add nullable `source_platform_course_module_id` (→ `platform_course_modules.id`) and
`source_platform_course_content_item_id` (→ `platform_course_content_items.id`) columns to
`course_modules` and `content_items` respectively, populated at clone time and kept in sync at every
subsequent "apply update." Applying an update matches each platform module/content-item to the tenant's
existing row by this id (not by title or position, which can both change) — a match is `UPDATE`d in
place (same row, same `id`); a platform item with no matching tenant row is `INSERT`ed (as a clone,
`source_...` set); a tenant row whose source id no longer appears among the platform's current
modules/items is `DELETE`d.

**Rationale**: `apps/api/src/db/schema/learner-content-progress.ts:9-10` documents that
`learner_content_progress.content_item_id` deliberately has **no** database-level foreign key, precisely
so deleting a touched content item never cascades into destroying learner history. That same lack of an
FK is what makes "keep progress, update content" (the locked product decision) achievable at all: as
long as a content item that persists across platform versions keeps the *same tenant-side row id*
across an update, every `learner_content_progress` row referencing it keeps resolving correctly with
zero extra work. Without a stable source-id mapping, "apply update" would have no reliable way to tell
"this platform item is the same lesson, just edited" from "this is a brand-new lesson that happens to
have a similar title," and would be forced into a strategy that changes tenant-side ids (breaking
progress) or never removes/reorders content (failing to actually match the platform version).

**Consequence flagged, not silently absorbed** (already called out in spec's Clarifications and Edge
Cases, restated here as the concrete mechanism): a tenant content item whose `source_...` id is no
longer present on the platform course gets deleted on apply, and any `learner_content_progress` rows
that referenced it become orphaned (referencing a content-item id that no longer exists). This is the
explicitly accepted risk from the spec — not remediated by this design, only made precise.

**Alternatives considered**: Match by `(type, position)` tuple instead of a stable id. Rejected — a
Super Admin reordering modules (an explicitly supported, ordinary editing action per User Story 1) would
make every subsequent position-based match wrong, silently scrambling which tenant row gets updated
versus deleted; a stable id survives reordering by construction.

## 5. Notification de-duplication shape

**Decision**: Two more nullable/defaulted integer columns on `marketplace_selections`:
`notified_platform_course_version` (nullable) and `dismissed_platform_course_version` (nullable),
alongside `applied_platform_course_version` (not null, default 1, set to the platform course's version
at the moment of cloning). Given a selection row and its platform course's current `version`:

- **Update-available indicator** (FR-005) = `platformCourse.version > selection.appliedPlatformCourseVersion AND selection.dismissedPlatformCourseVersion IS DISTINCT FROM platformCourse.version`.
- **Notification-needed** (the condition the version-bump routine checks after every edit, FR-006) =
  `platformCourse.version > selection.appliedPlatformCourseVersion AND (selection.notifiedPlatformCourseVersion IS NULL OR selection.notifiedPlatformCourseVersion <= selection.appliedPlatformCourseVersion)`. The comparison is anchored to `appliedPlatformCourseVersion`, not to the edit's new `version` — that's what makes it idempotent across repeated edits: once a notification is sent, `notifiedPlatformCourseVersion` is stamped above `appliedPlatformCourseVersion` and *stays* above it (and therefore "outstanding, already notified") through every further edit, since further edits only raise `version` further, never `appliedPlatformCourseVersion`. The tenant stops seeing new emails until they actually apply (which advances `appliedPlatformCourseVersion` to match, making the comparison true again on the *next* edit). An earlier draft of this decision compared `notifiedPlatformCourseVersion` against the edit's new `version` instead of `appliedPlatformCourseVersion` — that version re-sent an email on every single edit rather than once per outstanding update, and was caught and fixed by `course-marketplace-updates.test.ts`'s de-dupe test before shipping.
- **Dismiss** (FR-008) sets `dismissedPlatformCourseVersion = platformCourse.version` (current version at
  the moment of dismissal) and touches nothing else — a later edit raises `version` past the dismissed
  value, so the indicator condition becomes true again automatically (matches Edge Cases: "dismissal only
  applies to the version it was shown for").
- **Apply** (FR-007) sets `appliedPlatformCourseVersion = platformCourse.version`, which alone makes both
  the indicator and notification-needed conditions false again (no separate reset of the other two
  columns is required, though `notifiedPlatformCourseVersion`/`dismissedPlatformCourseVersion` are left as
  their last values — harmless, since both comparisons are always anchored to the *current* course
  version at read time).

**Rationale**: Three small integer columns fully capture "what does this tenant know, and what have they
decided" without a separate notification-log table — proportional to the spec's own "prefer the simpler
option" instruction, and every comparison is a plain integer inequality evaluable in the same query that
already has to join `marketplace_selections` to `platform_courses`.

**Alternatives considered**: A separate `course_update_notifications` table (one row per sent email).
Rejected — nothing in the spec requires a history of past notifications, only a current outstanding/
dismissed/applied state; three columns on the row that already represents "this tenant's relationship to
this platform course" is a smaller, equally correct model.

## 6. Sending the notification from a Super-Admin-triggered request

**Decision**: The version-bump-and-notify step runs inside the same route handler as the triggering
edit, after the primary write commits. For each affected tenant, it opens a dedicated connection via
`apps/api/src/db/with-tenant-connection.ts`'s `withTenantConnection(fastify.pg.pool, tenantId, fn)` (the
exact mechanism `admin-marketplace-selection-routes.ts:88-89` already uses to write into a specific
tenant's RLS-protected tables from a Super-Admin session) to run the new "list users holding
`course.manage`" query and to stamp `notifiedPlatformCourseVersion` on that tenant's
`marketplace_selections` row.

**Rationale**: `apps/api/src/platform-auth/super-admin-context.ts:57-66` pins `request.superAdminDb` to
the nil UUID tenant for defensive RLS reasons — it cannot read a specific tenant's `user_roles`/`users`
join (that join is RLS-protected per-tenant data) or write that tenant's `marketplace_selections` row
under real tenant scope. `withTenantConnection` is the established, already-proven pattern for exactly
this "Super Admin action needs to touch one specific tenant's RLS-scoped data" situation.

**Alternatives considered**: Grant `request.superAdminDb` broader read access to `users`/`user_roles`
via an additional permissive RLS policy (mirroring `marketplace_selections`' own
`super_admin_full_access` policy). Rejected — widening RLS on the core `users`/`user_roles` tables for
every future Super Admin route is a much larger blast-radius change than this feature needs, when the
already-existing `withTenantConnection` helper solves the same problem per-request with no schema/policy
change at all.

## 7. Listing "every tenant user holding `course.manage`"

**Decision**: A new function, `listUsersWithPermission(tenantDb, permissionKey)`, added alongside
`userHasAnyPermission` in `apps/api/src/permissions/require-permission.ts` — the same
`user_roles ⋈ role_permissions ⋈ permissions` join, minus the `ur.user_id = $userId` filter, joined once
more to `users` for `id`/`email`/`full_name`, with `WHERE u.archived_at IS NULL` (archived/deactivated
members never receive notifications — mirrors how every other tenant-facing listing in this codebase
excludes archived users) and `DISTINCT` on user id (a user can hold `course.manage` through more than
one role).

**Rationale**: Grepping `apps/api/src/permissions/` and `apps/api/src/roles/` confirms no existing
"reverse" query (permission → user list) exists anywhere in the codebase — every current permission check
is single-user (`userHasAnyPermission`), because every current caller already knows which user it's
asking about (the request's own session). This spec is the first feature that needs to go the other
direction, so the query is new, not reused.

## 8. Mailer: where the new email lives

**Decision**: Extract the existing `sendMail`/`withTimeout`/`SEND_TIMEOUT_MS` guarantee-wrapper
(currently private to `apps/api/src/tenant-auth/mailer.ts:26-59`) into a new, small shared module,
`apps/api/src/mail/send-mail.ts`, exporting `sendMail(message: MailMessage): Promise<void>` with the same
non-blocking-failure/skip-when-unconfigured/bounded-timeout behavior, still built on the existing
`MailSender` interface and `activeSender` instance. `tenant-auth/mailer.ts` is updated to import and
re-use it (no behavior change to its three existing exported functions). A new file,
`apps/api/src/course-marketplace/course-update-mailer.ts`, exports
`sendCourseUpdateAvailableEmail(to: string, courseTitle: string, manageUrl: string): Promise<void>`,
built the same way `sendPasswordResetEmail` etc. are: call a new `buildCourseUpdateAvailableEmail(...)`
in `email-templates.ts` (reusing `paragraph`/`ctaButton`/`renderShell` — no new template primitives
needed), then `sendMail(...)`.

**Rationale**: `tenant-auth/mailer.ts` is a tenant-*auth*-specific module by name and by its three
existing exports (account creation, invite, password reset — all authentication-lifecycle emails). This
spec's email is triggered by a Super Admin course edit and consumed by course-marketplace logic — piling
it into an auth file would blur a domain boundary for no benefit, when the actual shared logic worth
reusing (`sendMail`'s guarantees) is a five-line function extractable without touching any of
`mailer.ts`'s existing call sites or behavior.

**Alternatives considered**: Add `sendCourseUpdateAvailableEmail` directly into `tenant-auth/mailer.ts`
next to the other three. Rejected per Constitution Principle XII's spirit (prefer the smaller, more
targeted change) applied to organization, not just dependencies — and because a future reader searching
"tenant auth emails" should not have to also find course-marketplace logic there.

## 9. Migration numbering

**Decision**: Next available Drizzle migration number is `0106` (latest on disk is
`0105_platform_file_attachments_course_and_link_kind.sql`).
