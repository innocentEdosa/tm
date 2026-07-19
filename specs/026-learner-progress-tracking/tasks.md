---

description: "Task list template for feature implementation"
---

# Tasks: Learner Progress & Attempt Tracking

**Input**: Design documents from `/specs/026-learner-progress-tracking/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/learner-progress-api.md, quickstart.md — all present.

**Tests**: Included, mirroring specs 023/024/025's own established convention for this codebase's
backend-only features.

**Organization**: Tasks are grouped by user story (spec.md: US1 = P1 "Record my own progress on a
content item", US2 = P1 "Read my own progress", US3 = P2 "Review learners' progress on a course").

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US3)
- File paths are exact, from plan.md's Project Structure

## Path Conventions

Existing pnpm/Turborepo monorepo — no new top-level project. Backend only:
`apps/api/src/`, `apps/api/drizzle/`, `apps/api/tests/`. No `apps/web` changes (spec is API-only).

---

## Phase 1: Setup

- [x] T001 Feature branch `026-learner-progress-tracking` checked out from a clean `master` (Constitution Principle X, after spec 025 was fast-forward-merged in) — already done this session.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The table, RLS, grants, and the validation helper — every user story depends on all of
these existing first.

**⚠️ CRITICAL**: No user story task may begin until this phase is complete.

- [x] T002 Add `learnerContentProgress` Drizzle table definition in `apps/api/src/db/schema/learner-content-progress.ts` per data-model.md (`id`, `tenant_id` FK `tenants.id`, `user_id` FK `users.id` (real FK — the learner), `content_item_id` uuid **no FK** (mirrors `file_attachments.entity_id`, research.md §1), `status` text `CHECK IN ('not_started','in_progress','completed','failed')` default `'not_started'`, `score_raw`/`score_min`/`score_max` numeric nullable, `bookmark` text nullable, `suspend_data` text nullable, `session_time_seconds` integer default 0, `total_time_seconds` integer default 0, `entered_at`/`exited_at`/`updated_at` timestamptz default now, unique `(tenant_id, user_id, content_item_id)`, index `(tenant_id, content_item_id)`)
- [x] T003 Generate and hand-check schema migration `apps/api/drizzle/0082_learner_content_progress_table.sql` (creates `learner_content_progress`) from T002 via `pnpm --filter api db:generate` (depends on T002)
- [x] T004 Add migration `apps/api/drizzle/0083_rls_learner_content_progress.sql` — `ENABLE`/`FORCE ROW LEVEL SECURITY` + standard `tenant_isolation` policy on `learner_content_progress`, using the hardened `NULLIF(...)` cast (mirrors `0080_rls_file_attachments.sql`) (depends on T003)
- [x] T005 Add migration `apps/api/drizzle/0084_lock_learner_content_progress_grants.sql` — `GRANT SELECT, INSERT, UPDATE, DELETE ON learner_content_progress TO tm_app` (mirrors `0081_lock_file_attachments_grants.sql`) (depends on T004)
- [x] T006 Apply all pending migrations (`pnpm --filter api db:migrate`) and confirm `learner_content_progress`, its RLS policy, and the grant all exist — verify directly via `psql` against the local dev database (re-verify `DATABASE_URL` points at local Postgres, not production, before running) (depends on T005)
- [x] T007 [P] Implement `apps/api/src/progress/progress-validation.ts` — `validateProgressUpdate(body)` returning `{ error: string | null }`: rejects if `status` missing or not one of the four fixed values; rejects if `scoreRaw` is provided alongside both `scoreMin` and `scoreMax` and falls outside `[scoreMin, scoreMax]` (research.md §6); rejects if `suspendData` exceeds 4096 characters (research.md §7); any other field combination/omission is valid
- [x] T008 Create `apps/api/src/progress/tenant-progress-routes.ts` as a Fastify plugin (empty route scaffold, to be filled in by US1-US3 tasks below) and register it in `apps/api/src/server.ts` (depends on T002)

**Checkpoint**: Table, RLS, grant, and validation helper all exist. User story implementation can begin.

---

## Phase 3: User Story 1 - Record my own progress on a content item (Priority: P1) 🎯 MVP

**Goal**: A user holding `course.view` (or `course.manage`) records or updates their own progress on a
content item — the foundational capability this entire spec exists for.

**Independent Test**: As a user holding `course.view`, submit a progress update for a content item with
a status and a bookmark, then submit a second update and verify the row was updated in place (not
duplicated) with `totalTimeSeconds` accumulated.

### Implementation for User Story 1

- [x] T009 [US1] Add `PUT /tenant/content-items/:contentItemId/progress` handler in `apps/api/src/progress/tenant-progress-routes.ts` — `requireAnyPermission("course.view", "course.manage")`; `404` if `contentItemId` doesn't resolve in the caller's tenant; runs `validateProgressUpdate` (T007), returning `400` on failure; upserts `(tenant, request.user!.id, contentItemId)` (`ON CONFLICT` on the unique index from T002): on first write sets `enteredAt: now`; on any write sets `status`/`scoreRaw`/`scoreMin`/`scoreMax`/`bookmark`/`suspendData` to the submitted values (replacing prior values wholesale, `status` transitions never validated — spec Clarifications Q1), adds submitted `sessionTimeSeconds` (default 0) to `totalTimeSeconds`, sets `exitedAt`/`updatedAt: now`; responds `200` with the resulting row (contracts §PUT) (depends on T006, T007, T008)
- [x] T010 [P] [US1] Integration test `apps/api/tests/integration/progress-record-own.test.ts` — covers a first-write create (`enteredAt` set), a second-write update-in-place (same row, `totalTimeSeconds` accumulated, `enteredAt` unchanged), an update omitting `sessionTimeSeconds` leaving `totalTimeSeconds` unchanged while `status`/`bookmark` still apply (spec Edge Cases), a status regression accepted without error (`completed` → `in_progress`, spec Clarifications Q1), an inconsistent-score rejection (`scoreRaw` outside `[scoreMin, scoreMax]` → `400`), an over-length `suspendData` rejection (`400`), a missing/invalid `status` rejection (`400`), cross-tenant/nonexistent `contentItemId` → `404`, and forbidden (`403`) for a caller holding neither `course.view` nor `course.manage` (spec US1 Acceptance Scenarios) (depends on T009)

**Checkpoint**: User Story 1 is fully functional and independently testable — a learner can record and
update their own progress.

---

## Phase 4: User Story 2 - Read my own progress (Priority: P1)

**Goal**: A learner reads their own progress on a single content item (with a synthetic "not started"
default when nothing exists yet) or across a whole course (curriculum-ordered), regardless of whether
they still hold `course.view`.

**Independent Test**: With a progress row already recorded, read it back as the same learner and confirm
every field round-trips; read a whole course's progress and confirm curriculum ordering; revoke
`course.view` from that learner's role and confirm self-read still succeeds.

### Implementation for User Story 2

- [x] T011 [US2] Add `GET /tenant/content-items/:contentItemId/progress` handler in `apps/api/src/progress/tenant-progress-routes.ts` — `requireTenantUserSession()` only, no permission check (FR-010, research.md §4); `404` if `contentItemId` doesn't resolve in the caller's tenant; returns the row for `(tenant, request.user!.id, contentItemId)` if it exists, or a synthetic `{ contentItemId, status: "not_started", scoreRaw: null, scoreMin: null, scoreMax: null, bookmark: null, suspendData: null, totalTimeSeconds: 0, enteredAt: null, exitedAt: null, updatedAt: null }` if it doesn't (contracts §GET single) (depends on T006, T008)
- [x] T012 [US2] Add `GET /tenant/courses/:courseId/progress` handler in `apps/api/src/progress/tenant-progress-routes.ts` — `requireTenantUserSession()` only, no permission check (FR-010); `404` if `courseId` doesn't resolve in the caller's tenant; joins `learner_content_progress` → `content_items` → `course_modules`, filtered to `user_id = request.user!.id` and `content_items.course_id = courseId`, ordered by `course_modules.position, content_items.position` (research.md §5); returns only rows that exist, empty array otherwise (contracts §GET course) (depends on T006, T008)
- [x] T013 [P] [US2] Integration test `apps/api/tests/integration/progress-read-own.test.ts` — covers reading an existing row (full round-trip), reading an untouched content item (synthetic "not started", not `404`), reading a whole course's progress ordered by curriculum position (multiple modules/content items, some touched some not), an empty-course-progress result for a course the caller never touched, self-read succeeding after the caller's `course.view` is revoked (SC-005), cross-tenant `contentItemId`/`courseId` → `404` (spec US2 Acceptance Scenarios) (depends on T009, T011, T012)

**Checkpoint**: User Stories 1 AND 2 both work independently — progress can be recorded and read back by
its own owner.

---

## Phase 5: User Story 3 - Review learners' progress on a course (Priority: P2)

**Goal**: An L&D admin or manager holding `course.view` or `course.manage` reviews every learner's
progress on a course's content items.

**Independent Test**: With two different learners each having recorded progress on the same course, read
that course's progress as a third user holding only `course.view` and confirm both learners' rows are
visible.

### Implementation for User Story 3

- [x] T014 [US3] Add `GET /tenant/courses/:courseId/progress/learners` handler in `apps/api/src/progress/tenant-progress-routes.ts` — `requireAnyPermission("course.view", "course.manage")`; `404` if `courseId` doesn't resolve in the caller's tenant; same join as T012 without the `user_id` filter, additionally joined to `users` for a `learner` display name, ordered by curriculum position then learner (research.md §5); empty array for a course nobody has recorded progress on (contracts §GET learners) (depends on T006, T008)
- [x] T015 [P] [US3] Integration test `apps/api/tests/integration/progress-review-course.test.ts` — covers reviewing a course with progress from multiple learners (both visible, identified by learner), an empty result for an untouched course, cross-tenant `courseId` → `404`, and forbidden (`403`) for a caller holding neither `course.view` nor `course.manage` (spec US3 Acceptance Scenarios) (depends on T009, T014)

**Checkpoint**: All three user stories are independently functional — the full spec scope is complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verification work that spans or sits outside individual user stories.

- [x] T016 [P] Validate quickstart.md's eight scenarios: Scenarios 1-2 (record/update, accumulation) are covered by T010; Scenario 3-4 (self-read, untouched item) by T013; Scenario 5 (inconsistent score) by T010; Scenario 6 (manager review) by T015; Scenario 7 (self-read survives losing `course.view`) by T013; Scenario 8 (tenant isolation/permission gating) by T010/T013/T015 — no separate consolidated sweep file is needed given this spec's four-route surface already has full per-story coverage, and no external service is involved so no manual live-credential walkthrough caveat applies (unlike spec 025) (depends on T010, T013, T015)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — already complete (T001).
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories.
- **User Stories (Phase 3-5)**: All depend on Foundational phase completion.
  - US1 (Phase 3) has no dependency on any other story.
  - US2 (Phase 4) depends only on Foundational (T008) for its own handlers (T011/T012); its integration
    test (T013) depends on US1 (T009) to have data to read back.
  - US3 (Phase 5) depends only on Foundational (T008) for its own handler (T014); its integration test
    (T015) depends on US1 (T009) to have data to review.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each User Story

- Route handlers before their integration test.
- Story complete before moving to the next priority (or in parallel, per staffing).

### Parallel Opportunities

- T007 (validation helper) is independent of T002-T006 (DB migration chain) — both can proceed in
  parallel once Foundational phase starts, though T008's route scaffold needs T002 (the table import).
- All `[P]`-marked integration test tasks (T010, T013, T015, T016) can run in parallel with each other
  once their respective implementation tasks land.
- US2's handlers (T011/T012) and US3's handler (T014) can be built in parallel by two developers — both
  only depend on Foundational, not on each other or on US1's handler.

---

## Parallel Example: Foundational Phase

```bash
# Once T002 lands, these can proceed in parallel:
Task: "Generate schema migration from learner-content-progress.ts"
Task: "Implement progress-validation.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (already done).
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: Run T010 independently (record → update → verify accumulation).
5. Progress nobody can read back is unverifiable in practice — User Story 2 (self-read) is the natural
   next increment.

### Incremental Delivery

1. Complete Setup + Foundational → foundation ready (table, RLS, validation helper).
2. Add User Story 1 → test independently (record/update own progress).
3. Add User Story 2 → test independently (read own progress) → this is the first point the feature is
   genuinely usable end-to-end (a learner can record and later resume from their own bookmark).
4. Add User Story 3 → test independently (manager review across learners).
5. Phase 6 polish → full spec scope verified via automated tests (no external service, no live-credential
   caveat needed).

### Parallel Team Strategy

With multiple developers: all complete Setup + Foundational together. Once Foundational lands, US1's
write handler and US2/US3's read handlers can all proceed in parallel (none depend on each other's
handler code, only on US1 for their own integration tests' data).

---

## Notes

- `[P]` tasks = different files, or same file with non-overlapping handlers and no completion-order
  dependency.
- `[Story]` label maps task to specific user story for traceability.
- Every user story is independently completable and testable against its own integration test file.
- Commit after each task or logical group.
- Stop at any checkpoint to validate a story independently before continuing.
- No route in this task list ever accepts a client-supplied `userId` — "self" is always derived from
  `request.user!.id` (spec FR-001/FR-010).
