---

description: "Task list template for feature implementation"
---

# Tasks: Course Creation

**Input**: Design documents from `/specs/023-course-creation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/course-management-api.md, quickstart.md — all present.

**Tests**: Included. Not explicitly requested by the spec, but every sibling backend-only feature this
plan mirrors (Department Management, Training Needs Analysis) shipped with integration tests as part
of its own task list, and plan.md's Project Structure already commits to specific test files —
omitting them here would be an unexplained deviation from established project convention.

**Organization**: Tasks are grouped by user story (spec.md: US1 = P1 "Add a course", US2 = P1 "Browse
and find courses", US3 = P2 "Keep course records accurate", US4 = P2 "Retire a course") to enable
independent implementation and testing of each.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- File paths are exact, from plan.md's Project Structure

## Path Conventions

Existing pnpm/Turborepo monorepo — no new top-level project. Backend only:
`apps/api/src/`, `apps/api/drizzle/`, `apps/api/tests/integration/`. No `apps/web` changes (spec is
API-only).

---

## Phase 1: Setup

- [x] T001 Feature branch `023-course-creation` checked out from a clean `master` (Constitution Principle X) — already done this session.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Tables, RLS, grants, permission seeding, tenant-provisioning wiring, and the shared
category-resolution helper — every user story depends on all of these existing first.

**⚠️ CRITICAL**: No user story task may begin until this phase is complete.

- [x] T002 [P] Add `courseCategoryTemplates` and `courseCategories` Drizzle table definitions in `apps/api/src/db/schema/course-categories.ts` per data-model.md (`course_category_templates`: `id`, `key` unique, `name`, `created_at`; `course_categories`: `id`, `tenant_id` FK `tenants.id`, `name`, `source_template_id` FK `course_category_templates.id` `SET NULL`, `created_by_user_id` FK `users.id` `SET NULL`, `created_at`, plus `uniqueIndex("course_categories_tenant_id_name_unique").on(tenantId, sql\`lower(name)\`)` mirroring `departments_tenant_id_name_unique`)
- [x] T003 Add `courses` Drizzle table definition in `apps/api/src/db/schema/courses.ts` per data-model.md (`id`, `tenant_id` FK `tenants.id`, `title`, `description`, `category_id` FK `course_categories.id` `RESTRICT`, `delivery_mode` `CHECK IN ('in_person','virtual','self_paced','blended')`, `duration_value` numeric(6,2) `CHECK > 0`, `duration_unit` `CHECK IN ('minutes','hours','days')`, `provider`, `cost` numeric(12,2) `CHECK (cost IS NULL OR cost >= 0)`, `status` `CHECK IN ('draft','active','archived')` default `'draft'`, `created_by_user_id`/`updated_by_user_id` FK `users.id` `SET NULL`, `created_at`/`updated_at`, plus indexes `(tenant_id, status)` and `(tenant_id, category_id)`) (depends on T002 for the `category_id` FK reference)
- [x] T004 Generate and hand-check schema migration `apps/api/drizzle/0068_course_tables.sql` (creates `course_category_templates`, `course_categories`, `courses`) from T002/T003 via `pnpm --filter api db:generate` (depends on T002, T003)
- [x] T005 [P] Add migration `apps/api/drizzle/0069_rls_course_categories.sql` — `ENABLE`/`FORCE ROW LEVEL SECURITY` + standard `tenant_isolation` policy on `course_categories`, using the hardened `NULLIF(...)` cast (`0032`), matching `0034`'s post-hardening convention (depends on T004)
- [x] T006 [P] Add migration `apps/api/drizzle/0070_rls_courses.sql` — same `tenant_isolation` policy shape on `courses` (depends on T004)
- [x] T007 Add migration `apps/api/drizzle/0071_lock_course_catalog_grants.sql` — `GRANT SELECT` only on `course_category_templates` to `tm_app` (mirrors `department_templates`); `GRANT SELECT, INSERT, UPDATE, DELETE` on `course_categories` and `courses` to `tm_app` (mirrors `0012_lock_department_catalog_grants.sql`/`0047_lock_training_needs_grants.sql`) (depends on T005, T006)
- [x] T008 [P] Add seed migration `apps/api/drizzle/0072_seed_course_category_templates.sql` — `INSERT INTO course_category_templates (key, name)` six rows: `leadership`/"Leadership", `compliance`/"Compliance", `technical`/"Technical", `soft_skills`/"Soft Skills", `onboarding`/"Onboarding", `other`/"Other" (spec Clarifications) (depends on T004)
- [x] T009 [P] Add seed migration `apps/api/drizzle/0073_seed_course_permissions.sql` — `INSERT INTO permissions` for `course.view`, `course.manage`; `INSERT INTO role_template_permissions` (both keys → `hr_admin`); idempotent backfill `INSERT INTO role_permissions` for every already-live tenant role matched by **both** `source_template_id` **and** role name in the same statement (research.md §5, the `0038`-learned combined approach) — mirrors `0025_seed_department_permissions.sql`/`0038_seed_granular_crud_permissions.sql` (depends on T004)
- [x] T010 [P] Implement `seedDefaultCourseCategoriesForTenant(tenantDb, tenantId)` in `apps/api/src/provisioning/seed-default-course-categories.ts` — reads all `course_category_templates` rows, inserts one `course_categories` row per template with `sourceTemplateId` set and `createdByUserId: null`, returns `{ categoriesCreated: number }`; structurally identical to `seedDefaultDepartmentsForTenant` (`apps/api/src/provisioning/seed-default-departments.ts`) (depends on T004)
- [x] T011 Wire `seedDefaultCourseCategoriesForTenant` into `apps/api/src/provisioning/provision-tenant.ts` — call it alongside the existing `seedDefaultDepartmentsForTenant` call, same transaction (depends on T010)
- [x] T012 [P] Add backfill migration `apps/api/drizzle/0074_backfill_course_categories_existing_tenants.sql` — for every already-provisioned tenant with zero `course_categories` rows, insert the same six seeded rows (`source_template_id` joined from `course_category_templates` by `key`), mirroring `0023_backfill_tenant_auth_methods.sql`'s precedent of backfilling a default for tenants provisioned before the feature existed (depends on T008)
- [x] T013 Apply all pending migrations (`pnpm --filter api db:migrate`) and confirm `course_category_templates` (6 rows), `course_categories` (6 rows × every existing tenant), `courses` (empty), both RLS policies, the grants, and the two new permissions (backfilled onto every already-live `hr_admin`-sourced tenant role) all exist — verify directly via `psql` (depends on T005, T006, T007, T009, T012)
- [x] T014 Implement `resolveOrCreateCourseCategory(tenantDb, tenantId, name)` in `apps/api/src/courses/course-category-resolution.ts` per research.md §3/§4 — trims/lowercases for lookup, `SELECT id FROM course_categories WHERE tenant_id = :tenant AND lower(name) = lower(:name)`; if none found, `INSERT ... ON CONFLICT (tenant_id, lower(name)) DO NOTHING RETURNING id`, re-`SELECT` if the insert returned no row (lost a concurrent race); returns `{ id: string, name: string }` (depends on T003, T013)
- [x] T015 Created `apps/api/src/courses/tenant-course-routes.ts` as a Fastify plugin and registered it in `apps/api/src/server.ts` — built with all route handlers directly (T016/T017/T019/T020/T022/T024) rather than as an empty scaffold, matching the precedent `tenant-training-needs-routes.ts`'s own T010 set (the shared `toResponseRows` join helper was clearer to design once, together) (depends on T003)

**Checkpoint**: Tables, RLS, grants, permissions, provisioning wiring, the shared category-resolution helper, and the route-plugin skeleton all exist. User story implementation can begin.

---

## Phase 3: User Story 1 - Add a course to the catalog (Priority: P1) 🎯 MVP

**Goal**: A user holding `course.manage` creates a new course record (title, category, delivery mode,
duration, optionally description/provider/cost), landing as `status: "draft"`, with an unrecognized
category name auto-created inline rather than rejected.

**Independent Test**: As a user holding `course.manage`, submit a create request with all required
fields and a brand-new category name; confirm the course is created as `draft` and the category now
appears in the tenant's category list — without any separate category-creation call.

### Implementation for User Story 1

- [x] T016 [US1] Add `POST /tenant/courses` handler in `apps/api/src/courses/tenant-course-routes.ts` — `requirePermission("course.manage")`; `400` if `title`/`category`/`deliveryMode`/`duration.value`/`duration.unit` missing/blank; `422` if `deliveryMode` or `duration.unit` isn't a valid enum value, `duration.value <= 0`, or `cost < 0`; resolves `category` via `resolveOrCreateCourseCategory` (T014); inserts with `status: "draft"`, `createdByUserId`: caller; responds `201` with the created course (contracts §POST) (depends on T014, T015)
- [x] T017 [US1] Add `GET /tenant/courses/categories` handler in the same file — `requireAnyPermission("course.view", "course.manage")`; returns every category belonging to the tenant, ordered by `name` (contracts §GET categories, FR-001c) (depends on T015)
- [x] T018 [P] [US1] Integration test `apps/api/tests/integration/course-create-validation.test.ts` — covers missing-required-field rejection, invalid `deliveryMode`/`duration.unit` rejection, forbidden for a `course.view`-only caller, category auto-create on an unrecognized name, and case-insensitive dedupe (submitting `"leadership"` resolves to the seeded `"Leadership"` row, no duplicate created) — mirrors `department-permission-gating.test.ts` (spec US1 Acceptance Scenarios) (depends on T016, T017)

**Checkpoint**: User Story 1 is fully functional and independently testable — course creation with inline category auto-create works end-to-end.

---

## Phase 4: User Story 2 - Browse and find courses in the catalog (Priority: P1)

**Goal**: A user holding `course.view` or `course.manage` lists the tenant's courses (archived excluded
by default), narrows by title search or by category/delivery-mode/status filters, and fetches a single
course by id.

**Independent Test**: With a tenant that has several courses across categories/statuses/delivery
modes, list them, confirm search and each filter narrow correctly, and fetch one by id.

### Implementation for User Story 2

- [x] T019 [US2] Add `GET /tenant/courses` handler in `apps/api/src/courses/tenant-course-routes.ts` — `requireAnyPermission("course.view", "course.manage")`; excludes `status = 'archived'` unless an explicit `status` query param is supplied; supports `search` (title `ILIKE`), `category`, `deliveryMode`, `status` filters; paginates via `page`/`pageSize` matching `tenant-training-needs-routes.ts`'s existing shape (research.md §7); responds `{ success: true, data, pagination }`, empty `data: []` for zero matches or a page past the last one (contracts §GET list) (depends on T015, T013)
- [x] T020 [US2] Add `GET /tenant/courses/:courseId` handler in the same file — `requireAnyPermission("course.view", "course.manage")`; `404` if `courseId` doesn't resolve in the caller's tenant (RLS makes a cross-tenant id simply not found, contracts §GET by id) (depends on T019)
- [x] T021 [P] [US2] Integration test `apps/api/tests/integration/course-list-and-lookup.test.ts` — covers default archived-exclusion, title search, category/deliveryMode/status filters, empty-tenant `[]`, get-by-id success, cross-tenant id → `404`, and forbidden for a caller holding neither permission (spec US2 Acceptance Scenarios) (depends on T019, T020)

**Checkpoint**: User Stories 1 AND 2 both work independently — the catalog can be built and browsed end-to-end.

---

## Phase 5: User Story 3 - Keep course records accurate (Priority: P2)

**Goal**: A user holding `course.manage` updates an existing course's fields, including setting
`status` directly to any valid value with no restricted transition graph (un-archiving via a normal
update, not a separate action).

**Independent Test**: As a `course.manage` holder, update an existing course's `cost` and its `status`
from `draft` to `active`, then re-fetch it and confirm both changes persisted with a refreshed
`updatedBy`/`updatedAt`; separately, update an `archived` course's `status` to `active` and confirm it
becomes active again via this same endpoint.

### Implementation for User Story 3

- [x] T022 [US3] Add `PATCH /tenant/courses/:courseId` handler in `apps/api/src/courses/tenant-course-routes.ts` — `requirePermission("course.manage")`; `404` if not found in tenant; same field-level validation as `POST` for any field present; `status`, if present, is set directly to any of its three enum values with no restricted transition graph (spec Clarifications/FR-005); `category`, if present, re-resolved via `resolveOrCreateCourseCategory` (T014); sets `updatedByUserId`: caller, `updatedAt`: now on every successful write (contracts §PATCH) (depends on T014, T020)
- [x] T023 [P] [US3] Integration test `apps/api/tests/integration/course-update-and-transitions.test.ts` — covers a successful multi-field update with `updatedBy`/`updatedAt` refresh, invalid-enum rejection with no partial update, forbidden for a `course.view`-only caller, cross-tenant id → `404`, and `archived` → `active` via a plain `PATCH` (spec US3 Acceptance Scenarios) (depends on T022)

**Checkpoint**: User Stories 1, 2, AND 3 all work independently.

---

## Phase 6: User Story 4 - Retire a course without losing its history (Priority: P2)

**Goal**: A user holding `course.manage` archives a course via a dedicated convenience action —
idempotent on an already-archived course, never hard-deletes the row.

**Independent Test**: As a `course.manage` holder, archive a course, confirm it disappears from the
default (unfiltered) list but is still fetchable directly by id and via an explicit
`status=archived` filter, then archive it again and confirm the second call also succeeds with no
error.

### Implementation for User Story 4

- [x] T024 [US4] Add `POST /tenant/courses/:courseId/archive` handler in `apps/api/src/courses/tenant-course-routes.ts` — `requirePermission("course.manage")`; `404` if not found in tenant; equivalent to `PATCH { status: "archived" }` (sets `updatedByUserId`/`updatedAt`); succeeds idempotently (`200`, no error) if the course is already `archived` (contracts §POST archive, FR-006) (depends on T022)
- [x] T025 [P] [US4] Integration test `apps/api/tests/integration/course-archive-idempotent.test.ts` — covers archive excludes from the default list, still gettable by id, included with an explicit `status=archived` filter, idempotent re-archive (no error, status unchanged), and forbidden for a `course.view`-only caller (spec US4 Acceptance Scenarios) (depends on T024, T019)

**Checkpoint**: All four user stories are independently functional — the full spec scope is complete.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Verification and consistency work that spans every user story.

- [x] T026 [P] Integration test `apps/api/tests/integration/course-cross-tenant-isolation.test.ts` — covers SC-003 across every mutating endpoint (create is inherently same-tenant by construction; update, archive) attempting to act on another tenant's course id, confirming each responds `404` (depends on T022, T024)
- [x] T027 [P] Update `apps/api/tests/integration/seed-default-roles.test.ts` and `apps/api/tests/integration/provision-tenant-admin-role.test.ts` — both hardcode the full `hr_admin` permission list (existing precedent: each prior permission-adding spec, e.g. `training_request.*`, required the same update); add `course.view`/`course.manage` to the expected list (depends on T009)
- [x] T028 [P] Validated quickstart.md's five scenarios — not via literal `curl` against a `pnpm dev` process (would require a real tenant OTP email round-trip through the live mail provider, `src/mail/zeptomail-sender.ts`, to obtain a session cookie), but via equivalent integration tests exercising the identical HTTP request/response cycle (Fastify `.inject()`, full route matching/validation/permission hooks) against the same real local Postgres instance: Scenario 1-2 (create + auto-create category) → course-create-validation.test.ts; Scenario 3 (browse/search/filter) → course-list-and-lookup.test.ts; Scenario 4 (edit + un-archive) → course-update-and-transitions.test.ts; Scenario 5 (cross-tenant + permission gating) → course-list-and-lookup.test.ts + course-update-and-transitions.test.ts + course-archive-idempotent.test.ts + course-cross-tenant-isolation.test.ts. All pass. (depends on T016, T017, T019, T020, T022, T024)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — already complete (T001).
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories.
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion.
  - US1 (Phase 3) and US2 (Phase 4) have no dependency on each other — either can go first, or both in
    parallel with two developers, since US1 only touches `POST .../courses` + `GET .../categories` and
    US2 only touches `GET .../courses` + `GET .../courses/:id`, all additive to the same shared file
    but non-overlapping route handlers.
  - US3 (Phase 5) depends on US2's `GET /:courseId` existing to be independently *tested* against a
    real fetch-after-update flow, though its own `PATCH` handler only technically depends on
    Foundational (T014, T020's existence as a reference point for the 404 pattern, not a hard code
    dependency).
  - US4 (Phase 6) depends on US3's `PATCH` handler existing in the same file (T022) since the archive
    action is implemented as a thin wrapper around the same update logic.
- **Polish (Phase 7)**: Depends on all four user stories being complete.

### Within Each User Story

- Route handlers before their integration test.
- Story complete before moving to the next priority (or in parallel, per staffing).

### Parallel Opportunities

- T002 (course-categories schema) has no dependency and can start immediately after T001.
- T005/T006 (RLS migrations) are independent of each other, both depending only on T004.
- T008/T009 (category-template seed, permission seed) are independent of each other, both depending only on T004.
- Once Foundational (Phase 2) completes, US1 and US2 can proceed in parallel (different route handlers, same file — coordinate on non-overlapping edits).
- All `[P]`-marked integration test tasks (T018, T021, T023, T025, T026, T027) can run in parallel with each other once their respective implementation tasks land.

---

## Parallel Example: Foundational Phase

```bash
# After T004 (schema migration) lands, these four can run in parallel:
Task: "Add migration apps/api/drizzle/0069_rls_course_categories.sql"
Task: "Add migration apps/api/drizzle/0070_rls_courses.sql"
Task: "Add seed migration apps/api/drizzle/0072_seed_course_category_templates.sql"
Task: "Add seed migration apps/api/drizzle/0073_seed_course_permissions.sql"
```

## Parallel Example: User Story 1

```bash
# T016 and T017 touch the same file but different, non-overlapping handlers — sequence them if solo;
# if paired, land T016 first (T017 has no dependency on it, but avoids a merge in the same file):
Task: "Add POST /tenant/courses handler"
Task: "Add GET /tenant/courses/categories handler"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (already done).
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: Run T018 and quickstart.md Scenarios 1-2 independently.
5. At this point courses can be created (with auto-created categories) but not yet listed back via the
   API in a useful way beyond direct-id lookups a client would have to already know — User Story 2 is
   the natural next increment before this is genuinely usable.

### Incremental Delivery

1. Complete Setup + Foundational → foundation ready.
2. Add User Story 1 → test independently (create + categories).
3. Add User Story 2 → test independently (list/search/filter/get) → this is the first point the catalog
   is genuinely usable end-to-end (create, then find what you created).
4. Add User Story 3 → test independently (edit, including un-archive).
5. Add User Story 4 → test independently (archive convenience action).
6. Phase 7 polish → full spec scope verified via quickstart.md.

### Parallel Team Strategy

With two developers: both complete Setup + Foundational together, then Developer A takes US1 while
Developer B takes US2 (non-overlapping route handlers in the same file — coordinate merges); once both
land, either developer can take US3 then US4 (each depends on the prior story's handler existing in the
same file, so these two are naturally sequential, not parallelizable across two people).

---

## Notes

- `[P]` tasks = different files, or same file with non-overlapping handlers and no completion-order
  dependency.
- `[Story]` label maps task to specific user story for traceability.
- Every user story is independently completable and testable against its own integration test file.
- Commit after each task or logical group.
- Stop at any checkpoint to validate a story independently before continuing.
- No `DELETE` endpoint exists anywhere in this task list — archiving (T024) is the only removal
  mechanism, by design (spec FR-011).
