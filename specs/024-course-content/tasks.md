---

description: "Task list template for feature implementation"
---

# Tasks: Course Content

**Input**: Design documents from `/specs/024-course-content/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/course-content-api.md, quickstart.md — all present.

**Tests**: Included, mirroring spec 023's own established convention for this codebase's backend-only
features (integration tests as part of the task list, not a separate ask).

**Organization**: Tasks are grouped by user story (spec.md: US1 = P1 "Build a module structure", US2 =
P1 "Add content to a module", US3 = P1 "Review a course's full curriculum", US4 = P2 "Keep the
curriculum accurate and well-ordered", US5 = P2 "Remove a module or content item").

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US5)
- File paths are exact, from plan.md's Project Structure

## Path Conventions

Existing pnpm/Turborepo monorepo — no new top-level project. Backend only:
`apps/api/src/`, `apps/api/drizzle/`, `apps/api/tests/integration/`. No `apps/web` changes (spec is
API-only).

---

## Phase 1: Setup

- [x] T001 Feature branch `024-course-content` checked out from a clean `master` (Constitution Principle X) — already done this session.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Tables, RLS, grants, and the shared payload-validation helper — every user story depends
on all of these existing first.

**⚠️ CRITICAL**: No user story task may begin until this phase is complete.

- [x] T002 Add `courseModules` and `contentItems` Drizzle table definitions in `apps/api/src/db/schema/course-content.ts` per data-model.md (`course_modules`: `id`, `tenant_id` FK `tenants.id`, `course_id` FK `courses.id` `RESTRICT`, `title`, `description`, `position` integer, `created_by_user_id`/`updated_by_user_id` FK `users.id` `SET NULL`, `created_at`/`updated_at`, index `(tenant_id, course_id)`; `content_items`: `id`, `tenant_id` FK, `course_id` FK `courses.id` `RESTRICT`, `module_id` FK `course_modules.id` `CASCADE`, `type` text `CHECK IN ('video','article','live_class','test','assignment','external_import')`, `title`, `description`, `position` integer, `payload` jsonb not null default `'{}'`, `created_by_user_id`/`updated_by_user_id` FK `users.id` `SET NULL`, `created_at`/`updated_at`, indexes `(tenant_id, course_id)` and `(tenant_id, module_id)`)
- [x] T003 Generate and hand-check schema migration `apps/api/drizzle/0075_course_content_tables.sql` (creates `course_modules`, `content_items`) from T002 via `pnpm --filter api db:generate` (depends on T002)
- [x] T004 [P] Add migration `apps/api/drizzle/0076_rls_course_modules.sql` — `ENABLE`/`FORCE ROW LEVEL SECURITY` + standard `tenant_isolation` policy on `course_modules`, using the hardened `NULLIF(...)` cast (mirrors `0069_rls_course_categories.sql`) (depends on T003)
- [x] T005 [P] Add migration `apps/api/drizzle/0077_rls_content_items.sql` — same `tenant_isolation` policy shape on `content_items` (depends on T003)
- [x] T006 Add migration `apps/api/drizzle/0078_lock_course_content_grants.sql` — `GRANT SELECT, INSERT, UPDATE, DELETE` on `course_modules` and `content_items` to `tm_app` (mirrors `0071_lock_course_catalog_grants.sql` — no read-only catalog table this time, both are fully tenant-owned) (depends on T004, T005)
- [x] T007 Apply all pending migrations (`pnpm --filter api db:migrate`) and confirm `course_modules`, `content_items`, both RLS policies, and the grants all exist — verify directly via `psql` (depends on T006)
- [x] T008 Implement `validateContentItemPayload(type, payload)` in `apps/api/src/course-content/content-item-payload-validation.ts` per data-model.md's per-type required-field table (`video`→`url`; `article`→at least one of `body`/`externalUrl`; `live_class`→`scheduledAt`; `test`→no required fields; `assignment`→no required fields; `external_import`→`url` and `sourceType`); returns `{ error: string } | { error: null }` (depends on T002)
- [x] T009 Created `apps/api/src/course-content/tenant-course-content-routes.ts` as a Fastify plugin and registered it in `apps/api/src/server.ts` alongside `tenantCourseRoutes` — built with all 9 route handlers directly (T010/T012/T014/T016-T019/T021-T022) rather than as an empty scaffold, matching the precedent both spec 023 and the Training Needs spec set for themselves (shared helpers — `buildUserById`, `toModuleRow`, `toContentItemRow` — were clearer to design once, together) (depends on T002)

**Checkpoint**: Tables, RLS, grants, the payload-validation helper, and the route-plugin skeleton all exist. User story implementation can begin.

---

## Phase 3: User Story 1 - Build a course's module structure (Priority: P1) 🎯 MVP

**Goal**: A user holding `course.manage` creates modules on a course, each appended after the last —
the foundational structural layer every other story builds on.

**Independent Test**: As a user holding `course.manage`, create three modules on an existing course and
confirm (via direct query or the curriculum-read endpoint once US3 lands) they exist in creation order.

### Implementation for User Story 1

- [x] T010 [US1] Add `POST /tenant/courses/:courseId/modules` handler in `apps/api/src/course-content/tenant-course-content-routes.ts` — `requirePermission("course.manage")`; `400` if `title` missing/blank; `404` if `courseId` doesn't resolve in the caller's tenant; inserts with `position = count(*)` of the course's existing modules (append-last, no `position` field accepted from the body — contracts §POST modules) and `createdByUserId`: caller (FR-012) (depends on T009)
- [x] T011 [P] [US1] Integration test `apps/api/tests/integration/course-content-modules.test.ts` — covers successful create with append-ordering (create three, confirm sequential `position` via direct DB query), missing-title rejection, cross-tenant/nonexistent `courseId` → `404`, forbidden for a `course.view`-only caller (spec US1 Acceptance Scenarios) (depends on T010)

**Checkpoint**: User Story 1 is fully functional and independently testable — module creation works end-to-end.

---

## Phase 4: User Story 2 - Add content to a module (Priority: P1)

**Goal**: A user holding `course.manage` adds content items of any of the six types to a module, each
validated against its type's required fields and appended after the last.

**Independent Test**: As a user holding `course.manage`, add one content item of each of the six types
to a module and confirm each is created with its type-specific `payload` intact.

### Implementation for User Story 2

- [x] T012 [US2] Add `POST /tenant/modules/:moduleId/content-items` handler in `apps/api/src/course-content/tenant-course-content-routes.ts` — `requirePermission("course.manage")`; `400` if `type` or `title` missing/blank; `404` if `moduleId` doesn't resolve in the caller's tenant; `422` if `type` isn't one of the six enum values or `validateContentItemPayload` (T008) returns an error; sets `courseId` from the resolved module (not accepted in the body); inserts with `position = count(*)` of the module's existing content items (append-last, contracts §POST content-items) and `createdByUserId`: caller (FR-012) (depends on T008, T009, T010)
- [x] T013 [P] [US2] Integration test `apps/api/tests/integration/course-content-items.test.ts` — covers a successful create for each of the six types with correct `payload`, invalid `type` rejection, a `video` missing `payload.url` rejection, an `article` missing both `body` and `externalUrl` rejection, an `external_import` missing `payload.sourceType` rejection, cross-tenant/nonexistent `moduleId` → `404`, forbidden for a `course.view`-only caller (spec US2 Acceptance Scenarios) (depends on T012)

**Checkpoint**: User Stories 1 AND 2 both work independently — modules and content items can be built.

---

## Phase 5: User Story 3 - Review a course's full curriculum (Priority: P1)

**Goal**: A user holding `course.view` or `course.manage` retrieves a course's complete curriculum —
every module in order, each with its content items in order.

**Independent Test**: With a course that has multiple modules and a mix of content-item types, fetch
its full curriculum and confirm every module and item appears in the correct order with its correct
type-specific fields.

### Implementation for User Story 3

- [x] T014 [US3] Add `GET /tenant/courses/:courseId/curriculum` handler in `apps/api/src/course-content/tenant-course-content-routes.ts` — `requireAnyPermission("course.view", "course.manage")`; `404` if `courseId` doesn't resolve in the caller's tenant; two flat queries (`course_modules` and `content_items`, both `WHERE course_id = :course ORDER BY position`, research.md §1) with content items grouped by `moduleId` and nested under their module in the response, joining `users` for `createdBy`/`updatedBy` full names on both entities (mirrors `tenant-course-routes.ts`'s `toResponseRows` batch-join pattern); empty array for a course with zero modules (contracts §GET curriculum) (depends on T009, T010, T012)
- [x] T015 [P] [US3] Integration test `apps/api/tests/integration/course-content-curriculum-read.test.ts` — covers a full multi-module, multi-type-content curriculum returned in correct order, an empty-module course returning `[]`, cross-tenant `courseId` → `404`, forbidden for a caller holding neither permission (spec US3 Acceptance Scenarios) (depends on T014)

**Checkpoint**: User Stories 1, 2, AND 3 all work independently — a curriculum can be built and read back end-to-end.

---

## Phase 6: User Story 4 - Keep the curriculum accurate and well-ordered (Priority: P2)

**Goal**: A user holding `course.manage` edits a module's or content item's fields, reorders modules
within a course or content items within a module, and moves a content item to a different module in the
same course.

**Independent Test**: As a user holding `course.manage`, edit a content item's title, reorder a
course's three modules into a new sequence, move a content item to a different module, and confirm all
three changes are reflected on the next curriculum read.

### Implementation for User Story 4

- [x] T016 [US4] Add `PATCH /tenant/modules/:moduleId` handler in `apps/api/src/course-content/tenant-course-content-routes.ts` — `requirePermission("course.manage")`; `404` if not found in tenant; `400` if `title` present but blank; no `position`/`courseId` field accepted; sets `updatedByUserId`/`updatedAt` (contracts §PATCH module) (depends on T010)
- [x] T017 [US4] Add `PATCH /tenant/content-items/:contentItemId` handler in the same file — `requirePermission("course.manage")`; `404` if not found in tenant; `422` if the body includes a `type` field (immutability violation) or `payload` fails `validateContentItemPayload` (T008) against the item's existing `type`; if `moduleId` is present, resolve the target module (`404` if not in tenant), reject `422` if its `courseId` doesn't match the content item's own `courseId` (research.md §6), and reset `position` to append-last in the target module; sets `updatedByUserId`/`updatedAt` (contracts §PATCH content-item) (depends on T008, T012)
- [x] T018 [US4] Add `POST /tenant/courses/:courseId/modules/reorder` handler in the same file — `requirePermission("course.manage")`; `404` if `courseId` not in tenant; `422` if the submitted `moduleIds` set doesn't exactly match the course's current module id set; rewrites every module's `position` to its index in the submitted list, in one transaction (contracts §POST modules/reorder) (depends on T010)
- [x] T019 [US4] Add `POST /tenant/modules/:moduleId/content-items/reorder` handler in the same file — same shape as T018, scoped to a module's content items (contracts §POST content-items/reorder) (depends on T012)
- [x] T020 [P] [US4] Integration test `apps/api/tests/integration/course-content-edit-reorder-move.test.ts` — covers a module field update, a content-item field update (with `payload` re-validated against its existing `type`), a `type`-change attempt rejected, a full module reorder reflected on next curriculum read, a full content-item reorder reflected on next read, a reorder with a missing/foreign id rejected `422`, a content-item move to a different module in the same course (appended last there, gone from the old module), a move attempt to a module in a *different* course rejected `422`, forbidden for a `course.view`-only caller on every write above (spec US4 Acceptance Scenarios) (depends on T016, T017, T018, T019)

**Checkpoint**: User Stories 1-4 all work independently.

---

## Phase 7: User Story 5 - Remove a module or content item (Priority: P2)

**Goal**: A user holding `course.manage` deletes a content item, or an entire module (cascading to
remove every content item it holds).

**Independent Test**: As a user holding `course.manage`, delete a single content item and confirm it no
longer appears in the curriculum; delete a module with two content items in it and confirm both the
module and its items are gone.

### Implementation for User Story 5

- [x] T021 [US5] Add `DELETE /tenant/content-items/:contentItemId` handler in `apps/api/src/course-content/tenant-course-content-routes.ts` — `requirePermission("course.manage")`; `404` if not found in tenant; deletes the row (contracts §DELETE content-item) (depends on T012)
- [x] T022 [US5] Add `DELETE /tenant/modules/:moduleId` handler in the same file — `requirePermission("course.manage")`; `404` if not found in tenant; deletes the module, relying on `ON DELETE CASCADE` (T002/T003) to remove its content items (contracts §DELETE module) (depends on T010)
- [x] T023 [P] [US5] Integration test `apps/api/tests/integration/course-content-delete-cascade.test.ts` — covers content-item delete removing it from a subsequent curriculum read, module delete cascading to remove every content item it held (confirmed absent from the read, not orphaned), cross-tenant/nonexistent id → `404` for both delete endpoints, forbidden for a `course.view`-only caller (spec US5 Acceptance Scenarios) (depends on T021, T022)

**Checkpoint**: All five user stories are independently functional — the full spec scope is complete.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Verification and consistency work that spans every user story.

- [x] T024 [P] Integration test `apps/api/tests/integration/course-content-permission-tenant-isolation.test.ts` — a consolidated SC-003/SC-004 sweep across every one of the 9 endpoints (curriculum read, module create/update/delete/reorder, content-item create/update/delete/reorder) confirming each rejects a cross-tenant id as `404` and rejects a caller holding neither `course.view` nor `course.manage` (reads) or lacking `course.manage` (writes) as `403` — mirrors spec 023's `course-cross-tenant-isolation.test.ts` polish-phase pattern (depends on T010, T012, T014, T016, T017, T018, T019, T021, T022)
- [x] T025 [P] Validated quickstart.md's six scenarios via equivalent integration tests (same reasoning as spec 023's own T028 — a real session cookie would require a live tenant OTP email round-trip through the mail provider): Scenario 1 (build module structure) → course-content-modules.test.ts; Scenario 2 (add content of each type) → course-content-items.test.ts; Scenario 3 (read full curriculum) → course-content-curriculum-read.test.ts; Scenario 4 (reorder and move) → course-content-edit-reorder-move.test.ts; Scenario 5 (delete and cascade) → course-content-delete-cascade.test.ts; Scenario 6 (tenant isolation and permission gating) → course-content-permission-tenant-isolation.test.ts. All pass. (depends on T010, T012, T014, T016, T017, T018, T019, T021, T022)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — already complete (T001).
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories.
- **User Stories (Phase 3-7)**: All depend on Foundational phase completion.
  - US1 (Phase 3) has no dependency on any other story.
  - US2 (Phase 4) depends on US1's `POST .../modules` handler existing (a content item needs a module
    to attach to) — not just Foundational.
  - US3 (Phase 5) depends on US1 and US2's create handlers existing (there must be something to read),
    though its own route is otherwise independent.
  - US4 (Phase 6) depends on US1's and US2's create handlers (there must be something to edit/reorder/
    move).
  - US5 (Phase 7) depends on US1's and US2's create handlers (there must be something to delete).
- **Polish (Phase 8)**: Depends on all five user stories being complete.

### Within Each User Story

- Route handlers before their integration test.
- Story complete before moving to the next priority (or in parallel, per staffing, respecting the
  cross-story dependencies above).

### Parallel Opportunities

- T004/T005 (RLS migrations) are independent of each other, both depending only on T003.
- Once T010 (module create) and T012 (content-item create) both land, US3/US4/US5's route-handler tasks
  (T014, T016-T019, T021-T022) have no dependency *on each other* and could be built in parallel by
  multiple developers, though they share one file (`tenant-course-content-routes.ts`) so concurrent
  edits need coordination.
- All `[P]`-marked integration test tasks (T011, T013, T015, T020, T023, T024, T025) can run in parallel
  with each other once their respective implementation tasks land.

---

## Parallel Example: Foundational Phase

```bash
# After T003 (schema migration) lands, these two can run in parallel:
Task: "Add migration apps/api/drizzle/0076_rls_course_modules.sql"
Task: "Add migration apps/api/drizzle/0077_rls_content_items.sql"
```

## Parallel Example: User Story 4

```bash
# T016-T019 all touch the same file but non-overlapping handlers — sequence if solo;
# the four are otherwise independent of each other:
Task: "Add PATCH /tenant/modules/:moduleId handler"
Task: "Add PATCH /tenant/content-items/:contentItemId handler"
Task: "Add POST /tenant/courses/:courseId/modules/reorder handler"
Task: "Add POST /tenant/modules/:moduleId/content-items/reorder handler"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (already done).
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: Run T011 independently (module creation, append-ordering).
5. Modules alone hold no content a learner could use — User Story 2 is the natural next increment.

### Incremental Delivery

1. Complete Setup + Foundational → foundation ready.
2. Add User Story 1 → test independently (modules).
3. Add User Story 2 → test independently (content items) → curriculum can now be *built*.
4. Add User Story 3 → test independently (curriculum read) → this is the first point the curriculum is
   genuinely usable end-to-end (build it, then read back what was built).
5. Add User Story 4 → test independently (edit/reorder/move).
6. Add User Story 5 → test independently (delete/cascade).
7. Phase 8 polish → full spec scope verified via quickstart.md.

### Parallel Team Strategy

With multiple developers: all complete Setup + Foundational together. US1 must land first (US2/US3/US4/
US5 all depend on it existing). Once US1 and US2 both land, US3/US4/US5 can proceed in parallel by
different developers (coordinating merges within the shared route-plugin file).

---

## Notes

- `[P]` tasks = different files, or same file with non-overlapping handlers and no completion-order
  dependency.
- `[Story]` label maps task to specific user story for traceability.
- Every user story is independently completable and testable against its own integration test file.
- Commit after each task or logical group.
- Stop at any checkpoint to validate a story independently before continuing.
- No endpoint in this task list accepts an explicit target position on create or move — append-only by
  design (spec Clarifications); T018/T019's reorder endpoints are the only placement mechanism beyond
  "last."
