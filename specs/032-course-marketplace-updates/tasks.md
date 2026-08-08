---

description: "Task list for Course Marketplace Updates"

---

# Tasks: Course Marketplace Updates

**Input**: Design documents from `/specs/032-course-marketplace-updates/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/course-marketplace-updates-api.md, quickstart.md

**Tests**: Not explicitly requested in the feature spec beyond plan.md's general Testing note; test tasks are included only as a single Polish-phase coverage task (T026), not per-story TDD tasks.

**Organization**: Tasks are grouped by user story (spec.md) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Every task includes its exact file path

## Path Conventions

Web app monorepo per plan.md's Project Structure: `apps/api/src/...` (Fastify backend),
`apps/web/...` (Next.js frontend), `apps/api/drizzle/...` (migrations).

---

## Phase 1: Setup

**Purpose**: Land the schema this entire feature depends on.

- [X] T001 Write and apply migration `apps/api/drizzle/0106_course_marketplace_updates.sql` per
  data-model.md: `ALTER TABLE platform_courses ADD COLUMN version integer NOT NULL DEFAULT 1`; `ALTER
  TABLE marketplace_selections ADD COLUMN applied_platform_course_version integer NOT NULL DEFAULT 1`,
  `ADD COLUMN notified_platform_course_version integer`, `ADD COLUMN
  dismissed_platform_course_version integer`; `ALTER TABLE course_modules ADD COLUMN
  source_platform_course_module_id uuid REFERENCES platform_course_modules(id) ON DELETE SET NULL`;
  `ALTER TABLE content_items ADD COLUMN source_platform_course_content_item_id uuid REFERENCES
  platform_course_content_items(id) ON DELETE SET NULL`; plus supporting indexes on both new
  `source_...` columns. Run it against the local dev database.
- [X] T002 [P] Update `apps/api/src/db/schema/platform-courses.ts`: add `version: integer("version").notNull().default(1)`
  to `platformCourses`, and `appliedPlatformCourseVersion`, `notifiedPlatformCourseVersion`,
  `dismissedPlatformCourseVersion` columns to `marketplaceSelections`, matching T001's migration exactly.
- [X] T003 [P] Update `apps/api/src/db/schema/course-content.ts`: add
  `sourcePlatformCourseModuleId: uuid("source_platform_course_module_id").references(() =>
  platformCourseModules.id, { onDelete: "set null" })` to `courseModules`, and
  `sourcePlatformCourseContentItemId` (same pattern, referencing `platformCourseContentItems.id`) to
  `contentItems`, matching T001's migration exactly.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared infrastructure every user story's route changes call into.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 [P] Add `listUsersWithPermission(tenantDb, permissionKey): Promise<{id, email,
  fullName}[]>` to `apps/api/src/permissions/require-permission.ts` — same
  `user_roles ⋈ role_permissions ⋈ permissions` join as `userHasAnyPermission` minus the `userId`
  filter, joined to `users` for `id`/`email`/`full_name`, `WHERE u.archived_at IS NULL`, `DISTINCT` on
  user id (research.md §7).
- [X] T005 [P] Extract the existing `sendMail`/`withTimeout`/`SEND_TIMEOUT_MS` guarantee-wrapper out of
  `apps/api/src/tenant-auth/mailer.ts` into a new `apps/api/src/mail/send-mail.ts` exporting
  `sendMail(message: MailMessage): Promise<void>` with identical behavior (skip-when-unconfigured,
  bounded timeout, never-rethrow). Update `apps/api/src/tenant-auth/mailer.ts` to import it instead of
  keeping a private copy — its three existing exported functions (`sendTenantCreationEmail`,
  `sendMemberInviteEmail`, `sendPasswordResetEmail`) must behave identically after this change
  (research.md §8).
- [X] T006 [P] Add `buildCourseUpdateAvailableEmail(input: { courseTitle: string; manageUrl: string
  }): EmailTemplateResult` to `apps/api/src/mail/email-templates.ts`, reusing the existing
  `paragraph`/`ctaButton`/`renderShell` block builders — heading "An update is available for
  {courseTitle}" (research.md §8).
- [X] T007 Add `sendCourseUpdateAvailableEmail(to: string, courseTitle: string, manageUrl: string):
  Promise<void>` to new `apps/api/src/course-marketplace/course-update-mailer.ts`, calling T006's
  builder then T005's `sendMail` (depends on T005, T006).
- [X] T008 Add `recordPlatformCourseChange(db: Db, pool: Pool, platformCourseId: string,
  superAdminId: string): Promise<void>` to new
  `apps/api/src/course-marketplace/record-platform-course-change.ts`: `UPDATE platform_courses SET
  version = version + 1, updated_by_super_admin_id = $1, updated_at = now() WHERE id = $2 RETURNING
  version`; select every `marketplace_selections` row with `status = 'fulfilled'` for this course; for
  each where notification is still owed (data-model.md derived state:
  `notified_platform_course_version IS DISTINCT FROM` the new version AND `applied_platform_course_version
  <` the new version), open `withTenantConnection(pool, row.tenantId, ...)`, call T004's
  `listUsersWithPermission(tenantDb, "course.manage")`, call T007's
  `sendCourseUpdateAvailableEmail(...)` for each user, then stamp
  `notified_platform_course_version` to the new version on that selection row (contracts
  §Internal, research.md §5-§6; depends on T004, T007).

**Checkpoint**: Schema and shared infra exist; no route calls into them yet.

---

## Phase 3: User Story 1 - Super Admin edits a platform course tenants have already cloned (Priority: P1) 🎯 MVP

**Goal**: Remove the "frozen once cloned" restriction everywhere it's enforced, wire every successful
edit to bump the version (and, transitively, notify), and stop deleting R2 objects that existing tenant
clones may still reference.

**Independent Test**: As Super Admin, edit a platform course's title, add/edit/delete/reorder a
module or content item, and replace its course image, all after a tenant has already cloned it —
every action succeeds (no `409`), and the previous image's R2 object still exists afterward.

### Implementation for User Story 1

- [X] T009 [P] [US1] In `apps/api/src/platform-courses/platform-course-routes.ts`: delete the
  `IMMUTABLE_ONCE_CLONED_FIELDS` constant and its check in `PATCH /admin/platform-courses/:id`; call
  `recordPlatformCourseChange` (T008) after every successful write in this file (`POST`, `PATCH`,
  `PATCH .../objectives`).
- [X] T010 [P] [US1] In `apps/api/src/platform-courses/platform-course-content-routes.ts`: remove the
  local `rejectIfImmutable` function and its call from all 8 mutating routes (module
  create/update/delete/reorder, content-item create/update/delete/reorder); call
  `recordPlatformCourseChange` (T008) after each successful write.
- [X] T011 [P] [US1] In `apps/api/src/platform-courses/platform-course-file-routes.ts`: remove the
  local `rejectIfImmutable` function and its 3 call sites (course-image upload, content-item
  attachment create, generic `DELETE /admin/platform-file-attachments/:attachmentId`); add a
  `preserveObjects: boolean` parameter to `deleteAllAttachmentsForPlatformEntity` that skips the
  `storage.deleteObject()` call (but still deletes the DB rows) when `true`; pass `preserveObjects =
  await platformCourseHasFulfilledSelection(fastify.db, owningCourseId)` at every call site including
  the generic delete route; call `recordPlatformCourseChange` (T008) after every successful
  confirm/delete (not the initial pending-create, which isn't a real change yet).
- [X] T012 [P] [US1] Update the doc comment on `platformCourseHasFulfilledSelection` in
  `apps/api/src/course-marketplace/platform-course-immutability.ts` — it is now the
  notify/preserve-objects trigger, not a reject trigger (research.md §1).

**Checkpoint**: Super Admin can edit any platform course freely; `version` increments on every
content-affecting change; old file objects are preserved once clones exist.

---

## Phase 4: User Story 2 - Tenant is notified an update is available (Priority: P1)

**Goal**: Surface the version-vs-applied comparison to the tenant, both in the API response and as a
visible UI indicator.

**Independent Test**: After a Super Admin edit (User Story 1), a tenant's `GET /tenant/courses/:id`
returns `updateAvailable: true`, and the course list/detail screens show an "update available" badge.

### Implementation for User Story 2

- [X] T013 [US2] Extend `toResponseRows` in `apps/api/src/courses/tenant-course-routes.ts` to compute
  and include `updateAvailable: boolean` for both `GET /tenant/courses` and `GET
  /tenant/courses/:courseId` — join each course to its `marketplace_selections` row (by
  `clonedCourseId`, `status = 'fulfilled'`) and that row's `platform_courses` (by `platformCourseId`),
  using the derived-state formula from data-model.md (`platformCourse.version >
  appliedPlatformCourseVersion AND dismissedPlatformCourseVersion IS DISTINCT FROM
  platformCourse.version`); `false` for a course with no such selection (depends on T001/T002).
- [X] T014 [P] [US2] Add `updateAvailable: boolean` to the `Course` interface in
  `apps/web/lib/course-api-types.ts`.
- [X] T015 [US2] Add an "Update available" badge next to the existing status `Badge` in the row
  rendering of `apps/web/app/(dashboard-shell)/learning/courses/courses-list-client.tsx`, shown when
  `course.updateAvailable` (depends on T014).
- [X] T016 [US2] Add the same badge next to the header `Badge` in
  `apps/web/app/(dashboard-shell)/learning/courses/[courseId]/course-editor-client.tsx`, shown when
  `course.updateAvailable` (depends on T014).

**Checkpoint**: Both P1 stories deliver visible value end-to-end — Super Admin edits freely, tenants see
a pending update (and already received the notification email from User Story 1's wiring).

---

## Phase 5: User Story 3 - Tenant applies an available update (Priority: P1)

**Goal**: Reconcile a tenant's cloned course/curriculum in place against the platform course's current
content, without touching `learner_content_progress`.

**Independent Test**: As a tenant user holding `course.manage`, apply an available update on a course
with existing learner progress; confirm the course's title/curriculum now match the platform version,
and the learner's `learner_content_progress` rows are byte-for-byte unchanged.

### Implementation for User Story 3

- [X] T017 [US3] Add `applyPlatformCourseUpdateToTenant(tenantDb: Db, tenantId: string, courseId:
  string, selectionId: string, userId: string): Promise<void>` to
  `apps/api/src/course-marketplace/clone-platform-course.ts`, run inside one transaction: (a) update
  the tenant course row's metadata in place (title/description/deliveryMode/duration/provider/cost,
  category resolved via the existing `resolveOrCreateCourseCategory`) — leave `status` untouched; (b)
  reconcile the course image — if the platform's current "ready" image attachment's `storageKey`
  differs from the tenant's, delete the tenant's `file_attachments` row (row only, never call
  `storage.deleteObject` — the object is platform-owned/shared) and insert a new one referencing the
  platform's current key; (c) reconcile modules by `sourcePlatformCourseModuleId` — `UPDATE` matched
  rows in place (same `id`), `INSERT` new tenant rows (with `sourcePlatformCourseModuleId` set) for
  unmatched platform modules, `DELETE` tenant rows whose source id is no longer present; (d) reconcile
  content items the same way via `sourcePlatformCourseContentItemId`, scoped within each reconciled
  module; (e) for each reconciled content item, replace its `file_attachments` rows to mirror the
  platform's current "ready" attachment set (delete old rows, insert new ones referencing the same
  `storageKey`/`url`, never touching R2 objects); (f) rebuild `courses.outlineOrder` from the
  reconciled module id list; (g) `UPDATE marketplace_selections SET applied_platform_course_version =
  <platform course's current version> WHERE id = selectionId` (data-model.md, research.md §4; depends
  on T003).
- [X] T018 [US3] Add `POST /tenant/courses/:courseId/marketplace-update/apply` to
  `apps/api/src/course-marketplace/tenant-marketplace-routes.ts` —
  `requireTenantUserSession` + `requirePermission("course.manage")`; resolve the tenant's `fulfilled`
  `marketplace_selections` row for this course (`404` if none); `422` if
  `platformCourse.version <= appliedPlatformCourseVersion` (no update available); otherwise call T017
  inside a transaction and return the updated course via `toResponseRows` (T013) (depends on T017,
  T013).
- [X] T019 [P] [US3] Add `applyMarketplaceUpdate(courseId: string): Promise<Course>` to
  `tenantCourseEditorApi()` in `apps/web/lib/course-editor-adapter.ts`, `POST`ing to T018's route.
- [X] T020 [US3] Add an "Apply update" action next to the badge added in T016, wired to T019, with
  query invalidation on the course detail/list queries, in
  `apps/web/app/(dashboard-shell)/learning/courses/[courseId]/course-editor-client.tsx` (depends on
  T019, T016).

**Checkpoint**: Full P1 scope complete — tenants can see and act on updates, with learner progress
intact.

---

## Phase 6: User Story 4 - Tenant dismisses an available update (Priority: P2)

**Goal**: Let a tenant explicitly keep their current version without applying, until the next edit.

**Independent Test**: Dismiss an available update; confirm the course is completely unchanged and the
badge clears; confirm a further Super Admin edit brings the badge back.

### Implementation for User Story 4

- [X] T021 [US4] Add `POST /tenant/courses/:courseId/marketplace-update/dismiss` to
  `apps/api/src/course-marketplace/tenant-marketplace-routes.ts` — same auth and selection-lookup as
  T018 (factor the lookup into a shared local helper if convenient); `422` if no update is currently
  available; otherwise `UPDATE marketplace_selections SET dismissed_platform_course_version =
  <platform course's current version> WHERE id = selection.id` and return the updated course via
  `toResponseRows` (depends on T013, T018).
- [X] T022 [P] [US4] Add `dismissMarketplaceUpdate(courseId: string): Promise<Course>` to
  `tenantCourseEditorApi()` in `apps/web/lib/course-editor-adapter.ts`, `POST`ing to T021's route.
- [X] T023 [US4] Add a "Dismiss" action next to the "Apply update" action from T020, wired to T022,
  with the same query invalidation, in
  `apps/web/app/(dashboard-shell)/learning/courses/[courseId]/course-editor-client.tsx` (depends on
  T022, T020).

**Checkpoint**: All four user stories independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T024 [P] Run quickstart.md Scenarios 1-5 end-to-end against local dev, confirming every
  "expected" outcome.
- [X] T025 [P] Verify the Super Admin course-marketplace editor UI
  (`apps/web/app/(platform-shell)/admin/course-marketplace/[courseId]/page.tsx` and the shared
  `course-details-panel.tsx`) no longer surfaces any "frozen" messaging now that the API never `409`s
  for that reason — confirm this is purely reactive (only shown on a failed request) and there is no
  separate always-on lock indicator left over from spec 029 that needs removing.
- [X] T026 Add test coverage per plan.md's Testing section: version increments on every
  previously-frozen mutation type (US1), notification de-dupe across repeated edits before a tenant
  reacts (research.md §5, US2), apply reconciliation correctly matches/inserts/deletes
  modules/content-items (US3), and no `storage.deleteObject` call is recorded when replacing/deleting
  an attachment on a course with ≥1 fulfilled selection (US1).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup (T002/T003's schema types depend on T001's migration
  existing) — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational (calls `recordPlatformCourseChange`, T008).
- **User Story 2 (Phase 4)**: Depends on Foundational (schema) and reads data that only becomes
  meaningful once User Story 1's routes are wired — implement after US1 for a real end-to-end
  demonstration, though T013's code change itself has no hard code dependency on US1's files.
- **User Story 3 (Phase 5)**: Depends on Foundational (schema) and on T013 (US2) for the response
  shape it returns; functionally independent of US1/US2's route wiring otherwise.
- **User Story 4 (Phase 6)**: Depends on T013 (US2) and reuses T018's (US3) selection-lookup pattern —
  implement after US3.
- **Polish (Phase 7)**: Depends on all four user stories being complete.

### Parallel Opportunities

- T002, T003 (Setup) — different files.
- T004, T005, T006 (Foundational) — different files, no interdependency.
- T009, T010, T011, T012 (User Story 1) — four different files.
- T014 (User Story 2 frontend type) can start as soon as T013 lands; T015/T016 both depend on T014 but
  are different files, so parallel with each other.
- T019 (User Story 3 frontend adapter) can run parallel to T017/T018 (backend) since different files;
  T020 depends on both T019 and T016.
- T022 (User Story 4 frontend adapter) can run parallel to T021 (backend); T023 depends on both.
- T024, T025 (Polish) — independent verification tasks.

---

## Parallel Example: User Story 1

```bash
# All four User Story 1 tasks touch different files and share only the
# already-completed T008 dependency — safe to run together:
Task: "Remove IMMUTABLE_ONCE_CLONED_FIELDS gate in apps/api/src/platform-courses/platform-course-routes.ts"
Task: "Remove rejectIfImmutable from apps/api/src/platform-courses/platform-course-content-routes.ts"
Task: "Remove rejectIfImmutable + add preserveObjects in apps/api/src/platform-courses/platform-course-file-routes.ts"
Task: "Update doc comment in apps/api/src/course-marketplace/platform-course-immutability.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (schema).
2. Complete Phase 2: Foundational (recordPlatformCourseChange + its dependencies).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: Confirm a Super Admin can edit a previously-frozen platform course with zero
   `409`s, and that the previous file object still exists in R2 after a replace. This alone already
   fixes the core complaint ("editing fails once a tenant has selected the course") even before any
   tenant-facing update UI exists.
5. Deploy/demo if ready — the P1 slice already delivers standalone value.

### Incremental Delivery

1. Setup + Foundational → shared infrastructure ready.
2. User Story 1 → Super Admin unblocked (MVP, demoable on its own).
3. User Story 2 → tenants see the "update available" signal (email + badge).
4. User Story 3 → tenants can act on it, progress-safe (completes P1 scope).
5. User Story 4 → tenants can decline instead (P2, smaller and independent of US3's mechanics beyond
   the shared selection lookup).
6. Each story adds value without breaking the previous one — earlier stories never need to be revisited
   to accommodate a later one, since the version/applied/notified/dismissed model (data-model.md) was
   sized for all four stories from the start.

---

## Notes

- [P] tasks = different files, no dependency on an incomplete task in the same phase.
- [Story] label maps each task to its user story for traceability back to spec.md.
- No task in this feature modifies a file another concurrent task in the same phase also modifies —
  verified per-phase above.
- Commit after each task or logical group, per repository convention.
- Stop at any checkpoint to validate a story independently before continuing.
