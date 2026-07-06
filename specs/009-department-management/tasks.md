# Tasks: Department Management

**Input**: Design documents from `/specs/009-department-management/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — plan.md's Project Structure and Testing sections explicitly commit to new
Vitest integration test files mirroring this codebase's existing RLS/permission-gating test
convention (real Postgres, no mocks).

**Organization**: Tasks are grouped by user story (spec.md) to enable independent implementation and
testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Exact file paths are included in every task

## Path Conventions

Existing pnpm/Turborepo monorepo (plan.md Project Structure) — no new top-level project:
- Backend: `apps/api/src/...`, `apps/api/drizzle/...`, `apps/api/tests/integration/...`
- Frontend: `apps/web/app/(dashboard-shell)/...`
- Shared UI: `packages/ui/src/...`

---

## Phase 1: Setup

**Purpose**: Scaffold the new module/route directories this feature needs. No new dependency is
installed (plan.md — zero new packages required).

- [X] T001 Create the new backend module directory `apps/api/src/departments/` (empty, ready for
      T007/T019 below).
- [X] T002 [P] Create the new frontend route directory
      `apps/web/app/(dashboard-shell)/settings/department/` (empty, ready for T014/T015 below).
- [X] T003 [P] Confirm local Postgres is up-to-date with every prior migration
      (`pnpm --filter api db:migrate` against the existing `apps/api/drizzle/` set) before adding new
      ones in Phase 2.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema changes and shared query infrastructure every user story reads or writes.
`users.department_id` is included here (not deferred to US3) because US1's own list view already
needs real per-department member counts (spec FR-015). Manager/Assistant Manager columns are included
here too, since altering `departments` once for all five new columns is cleaner than a second pass.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Alter `departments` schema in `apps/api/src/db/schema/departments.ts`: add
      `parentDepartmentId` (nullable, self-referencing FK, `onDelete: "restrict"`), `description`
      (nullable text), `status` (text, not null, default `"active"`), `managerId` and
      `assistantManagerId` (both nullable FK → `users.id`, `onDelete: "set null"` — data-model.md,
      research.md §9). Generate the migration (`pnpm --filter api db:generate`) and hand-add, in the
      generated SQL file: the `CHECK (status IN ('active','archived'))` constraint (mirror
      `tenants_status_check` in `apps/api/drizzle/0008_init_tenant_provisioning.sql`) and a
      case-insensitive unique index on `(tenant_id, lower(name))` replacing the plain
      `departments_tenant_id_name_unique` constraint (data-model.md). **Done**: drizzle-kit generated
      the CHECK and expression index directly from the schema (`check()`/`uniqueIndex()` builders) —
      no hand-editing needed; migration `0024_hard_clint_barton.sql`, applied.
- [X] T005 Alter `users` schema in `apps/api/src/db/schema/users.ts`: add `departmentId` (nullable
      FK → `departments.id`, `onDelete: "restrict"`, mirroring `userRoles.roleId`'s FK convention in
      `apps/api/src/db/schema/roles.ts`). Generate the migration (`pnpm --filter api db:generate`).
      **After this task**: `departments.ts` and `users.ts` are mutually referencing — run
      `db:generate` once more (or re-run if T004/T005 were authored together) and confirm it produces
      a clean migration with no circular-import error (research.md §9); Drizzle's lazy
      `.references(() => ...)` callback is expected to handle this with no extra work. **Done**:
      generated cleanly in the same migration as T004 (`0024_hard_clint_barton.sql`) — no circular
      import error, both FKs present.
- [X] T006 [P] Add a new migration seeding the `department.view` / `department.manage` permission
      catalog rows in `apps/api/drizzle/` (mirror the `INSERT INTO permissions` pattern in
      `0014_seed_provision_tenant_permission.sql` / `0022_seed_tenant_auth_permissions.sql` — category
      `department`). **Done**: `0025_seed_department_permissions.sql` — also grants both permissions
      to the `hr_admin` role template + backfills existing hr_admin-sourced roles, matching
      0014/0022's actual precedent (a stricter reading of no-auto-grant was in research.md, but the
      codebase's own last two permission-seed migrations both auto-grant to a template; followed the
      real precedent so the feature is usable immediately, not locked out until a manual role edit).
- [X] T007 Implement the department-hierarchy query helpers in
      `apps/api/src/departments/department-hierarchy.ts`: `findAncestorChain(tenantDb, parentId)`
      (walks `parent_department_id` upward, `WITH RECURSIVE`, used for cycle+depth-cap checks),
      `collectSubtreeIds(tenantDb, departmentId)` (walks downward, used for the deletion-block rollup
      count), `hasChildren(tenantDb, departmentId)`, `directMemberCount(tenantDb, departmentId)`, and
      `subtreeMemberCount(tenantDb, departmentId)` (research.md §3, §7; data-model.md "Derived
      concepts"). Depends on T004, T005.
- [X] T008 [P] Add the new `Modal` primitive in `packages/ui/src/modal.tsx` (overlay + centered
      panel, close-on-overlay-click, Escape-to-close, styled to the existing `.surface-card`/`.btn`
      design system — research.md §6) and export it from `packages/ui/src/index.ts`.

**Checkpoint**: Foundation ready — schema (including Manager/Assistant Manager columns), permissions,
hierarchy queries, and the shared `Modal` primitive all exist. User story implementation can now
begin.

---

## Phase 3: User Story 1 - See the department structure (Priority: P1) 🎯 MVP

**Goal**: A user holding `department.view` (or `department.manage`) can open the Department nav
entry and see every department, nested correctly, searchable, with direct member count, status, and
Manager — with proper empty and no-permission states.

**Independent Test**: With a tenant that already has nested departments (seeded via T004's schema
default, `parent_department_id = NULL`, or manually inserted for the test), open the Department list
and confirm the hierarchy, search, and permission-gating all work — no create/edit/delete capability
is required for this story to be complete and demoable on its own.

### Tests for User Story 1

- [X] T009 [P] [US1] Integration test: a user without `department.view`/`department.manage` gets
      `403` from `GET /tenant/departments`, and a user with only `department.view` can read the list
      but is denied write actions, in
      `apps/api/tests/integration/department-permission-gating.test.ts`.

### Implementation for User Story 1

- [X] T010 [US1] Implement `GET /tenant/departments` (list + `search` query param, using T007's
      `directMemberCount`/`hasChildren` per row, ancestor-inclusive search per FR-014, and each row's
      `manager`/`assistantManager` resolved via a join against `users` for `id`/`fullName`) in the new
      `apps/api/src/departments/tenant-department-routes.ts` (contracts/department-management-api.md).
      Depends on T007.
- [X] T011 [US1] Register the new `tenantDepartmentRoutes` plugin in `apps/api/src/server.ts`
      alongside the other tenant-scoped route plugins. Depends on T010.
- [X] T012 [US1] Enable the "Department" nav entry in `apps/web/app/(dashboard-shell)/layout.tsx`:
      remove the `disabled`/`"Soon"` tag, keep it gated on `canManageTeam`-style permission checks for
      `department.view`/`department.manage` (mirrors the existing `canManageTeam`/`canManageAuth`
      pattern already in that file).
- [X] T013 [US1] Create the Server Component route guard
      `apps/web/app/(dashboard-shell)/settings/department/page.tsx` — session + permission check
      (403/redirect if neither `department.view` nor `department.manage`), mirrors
      `apps/web/app/(dashboard-shell)/settings/team/page.tsx`. Depends on T002.
- [X] T014 [US1] Build the department list/tree/search client UI in
      `apps/web/app/(dashboard-shell)/settings/department/department-settings-client.tsx`: fetch
      `GET /tenant-api/tenant/departments`, render as an expandable tree built client-side from the
      flat `parentDepartmentId` list (spec User Story 1, FR-001), a search input (FR-014), columns
      Name / Member count / Parent department (or "—") / Status / Manager (or "—"), and the empty
      state "No departments yet — create your first department to start organizing your team."
      (FR-017) versus a distinct "no search results" state. Uses `PageHeader`/`Card`/`Badge` from
      `@tm/ui` for the Active/Archived status pill. Depends on T010, T013.
- [X] T015 [US1] Add any new tree-row/indentation styles needed (expand chevron, nested-row
      indentation) to `apps/web/app/globals.css`, following the same pattern as the sidebar's
      `.shell-nav-group-children` indentation/guide-line treatment (Desktop Shell Visual Language
      spec) rather than inventing a new visual language.

**Checkpoint**: User Story 1 is fully functional and independently testable/demoable — the department
hierarchy is visible, searchable, and correctly permission-gated, even with no create/edit/delete UI
yet.

---

## Phase 4: User Story 2 - Build out and adjust the department structure (Priority: P1)

**Goal**: A user holding `department.manage` can create new departments (optionally nested, optionally
with a Manager/Assistant Manager), and edit an existing department's name/parent/description/
Manager/Assistant Manager — with duplicate-name, hierarchy (cycle/depth/cross-tenant), and
manager-assignment validation enforced both in the picker and server-side.

**Independent Test**: As a manage-holding user, create a top-level department, create a second one
nested under it, edit the second one's name and assign a Manager/Assistant Manager (searched from
across the whole tenant, not just that department's members), and confirm all of it saves and
displays correctly — independent of any delete/archive capability.

### Tests for User Story 2

- [X] T016 [P] [US2] Integration test: a direct API call setting `parentDepartmentId` to another
      tenant's department id behaves as "not found" (RLS-scoped lookup fails to resolve it), in
      `apps/api/tests/integration/department-cross-tenant-parent-blocked.test.ts`.
- [X] T017 [P] [US2] Integration test: (a) setting a department's parent to itself or one of its own
      descendants is rejected with `422`, and (b) creating a 4th-level department is rejected with
      `422`, in `apps/api/tests/integration/department-hierarchy-cycle-blocked.test.ts`.
- [X] T018 [P] [US2] Integration test: (a) a department's Manager/Assistant Manager can each be set to
      any user in the tenant, including one not assigned to that department; (b) setting the same
      user as both is rejected with `422`; (c) `GET /tenant/users?search=` requires a non-empty
      `search` and is gated by `department.manage`, in
      `apps/api/tests/integration/department-manager-assignment.test.ts`.

### Implementation for User Story 2

- [X] T019 [US2] Implement `POST /tenant/departments` in `tenant-department-routes.ts`: required
      `name` (case-insensitive duplicate check, `409` on conflict), optional `parentDepartmentId`
      (resolved via `request.tenantDb`; T007's `findAncestorChain` used to reject a depth > 3 chain),
      optional `description`, and optional `managerId`/`assistantManagerId` (each resolved as any
      tenant user via `request.tenantDb`; `422` if equal and both set); inserts with
      `status: "active"` (contracts/department-management-api.md). Depends on T007, T010.
- [X] T020 [US2] Implement `PATCH /tenant/departments/:departmentId` in the same file: same
      validations as create, plus the real cycle check via T007's `findAncestorChain`/
      `collectSubtreeIds` (reject if the proposed parent is `departmentId` itself or one of its
      descendants), and the same-person Manager/Assistant-Manager check re-evaluated against whatever
      isn't being changed in the current request. Depends on T019.
- [X] T021 [US2] Implement `GET /tenant/users?search=` in `tenant-department-routes.ts` (or a
      sibling file in the same module): `400` if `search` is missing/blank, else
      `id`/`fullName`/`email` for tenant users matching case-insensitively, gated by
      `department.manage` (research.md §10; contracts/department-management-api.md). Depends on T005.
- [X] T022 [US2] Build the Create/Edit Department form using the new `Modal` (T008) in
      `department-settings-client.tsx`: Name, Parent department (searchable dropdown excluding self +
      descendants + any depth-4-inducing option), Description, Status (edit only), and Manager /
      Assistant Manager (each a searchable picker backed by T021, excluding whichever of the pair is
      already chosen for the other field). Depends on T008, T014, T019, T020, T021.
- [X] T023 [US2] Wire the "Add department" button (visible only with `department.manage`) to open the
      Create form from T022, and Edit icon actions per row to open it pre-filled, in
      `department-settings-client.tsx`.
- [X] T024 [US2] Add client-side inline validation mirroring the server (duplicate name-as-you-type
      check against the already-fetched list; parent picker excludes invalid options rather than
      only failing on submit; Manager/Assistant Manager pickers block picking the same person twice)
      in `department-settings-client.tsx`.

**Checkpoint**: User Stories 1 AND 2 both work independently — the department tree can now be viewed
and actively built out/restructured, including Manager/Assistant Manager assignment.

---

## Phase 5: User Story 3 - Retire a department safely (Priority: P2)

**Goal**: A user holding `department.manage` can delete an empty, childless department in one action,
gets a specific blocking reason (with member count and a shortcut link) when members or children
exist anywhere in the subtree, and can archive instead as a non-destructive alternative regardless of
that block. A Manager/Assistant Manager assignment never factors into any of this.

**Independent Test**: Attempt to delete a department with members assigned (blocked, specific count
shown); delete an empty leaf department that has a Manager assigned (succeeds — the assignment never
blocks it); archive a department that still has members (succeeds where deletion was blocked) —
independent of User Story 4's downstream-picker behavior.

### Tests for User Story 3

- [X] T025 [P] [US3] Integration test: deleting a department (or an ancestor of one) with assigned
      members is blocked with `409`, `reason: "has_members"`, and the correct subtree-rollup
      `memberCount`, in `apps/api/tests/integration/department-delete-blocked-members.test.ts`.
- [X] T026 [P] [US3] Integration test: deleting a department with one or more child departments is
      blocked with `409`, `reason: "has_children"`, in
      `apps/api/tests/integration/department-delete-blocked-children.test.ts`.
- [X] T027 [P] [US3] Integration test: archiving a department that still has members and/or children
      succeeds (status becomes `"archived"`) even while deletion of the same department is blocked,
      in `apps/api/tests/integration/department-archive-alternative.test.ts`.
- [X] T028 [P] [US3] Integration test: a department with a Manager and/or Assistant Manager assigned,
      but no members and no children, deletes successfully in one call (FR-021 — confirms the
      assignment never blocks deletion), in
      `apps/api/tests/integration/department-manager-assignment.test.ts` (extends T018's file).

### Implementation for User Story 3

- [X] T029 [US3] Implement `DELETE /tenant/departments/:departmentId` in `tenant-department-routes.ts`:
      check T007's `subtreeMemberCount` first (block with member count + `membersListHref:
      "/settings/team?department=<id>"` per contracts/department-management-api.md), then `hasChildren`
      (block with the distinct "has sub-departments" reason), else delete (Manager/Assistant Manager
      columns simply go with the deleted row — no separate check, per FR-021). Depends on T007, T005,
      T020.
- [X] T030 [US3] Confirm `PATCH` (T020) already supports the `status` field transitioning freely to
      `"archived"` regardless of member/child count (no additional block) — add this as an explicit,
      separately-tested code path if the generic edit handler doesn't already exercise it cleanly.
- [X] T031 [US3] Add per-row Delete and Archive actions (icons, gated by `department.manage`) to
      `department-settings-client.tsx`: Delete opens a confirmation using `Modal`; on a `409` blocked
      response, show the specific reason (member count + link to `membersListHref`, or "has
      sub-departments") instead of a generic error, and offer "Archive instead" inline. Depends on
      T008, T022, T029.

**Checkpoint**: All P1/P2 user stories work independently — the department tree can be viewed, built
out, and safely retired without ever silently orphaning a member or child department, and without a
Manager/Assistant Manager assignment ever being mistaken for one of those blocking relationships.

---

## Phase 6: User Story 4 - Only active departments offered for new assignments (Priority: P3)

**Goal**: The one department-assignment picker that already exists in the product today (the "Add
team member" form) only ever offers Active departments, and archiving a department never disturbs an
existing member's assignment.

**Independent Test**: Archive a department that has an existing member; confirm the "Add team member"
form's department picker no longer offers it, while the existing member's assignment is untouched.

### Implementation for User Story 4

- [X] T032 [US4] Add an optional `departmentId` field to `POST /tenant-auth/team` in
      `apps/api/src/tenant-auth/tenant-team-routes.ts`: if provided, validated as an Active department
      in the caller's own tenant (via `request.tenantDb`) before being set on the new `users` row.
      Depends on T005.
- [X] T033 [US4] Add a "Department" field to the add-team-member form in
      `apps/web/app/(dashboard-shell)/settings/team/team-settings-client.tsx`, sourced from
      `GET /tenant-api/tenant/departments` filtered client-side (or via a `status=active` query param
      added to T010's endpoint) to Active departments only. Depends on T010, T032.

**Checkpoint**: All four user stories are independently functional. The feature is complete against
spec.md.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation hygiene and full end-to-end validation across every story.

- [X] T034 [P] Append this feature's new migrations (T004, T005, T006) to the "Full migration order
      (reference)" table in `apps/api/drizzle/README.md`, following its existing row format.
- [X] T035 [P] Re-run the existing `apps/api/tests/integration/rls-cross-tenant.test.ts` and
      `tenant-role-delete-blocked.test.ts` suites unchanged, confirming no regression from this
      feature's schema/route additions.
- [X] T036 Run every scenario in `specs/009-department-management/quickstart.md` end-to-end (including
      its final "Verifying no functional regression" step against Spec 002's provisioning quickstart)
      and fix any discrepancy found.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **BLOCKS all user stories** — `users.department_id`
  (T005), the Manager/Assistant Manager columns (T004), and the hierarchy helpers (T007) are read by
  US1, US2, and US3 alike, not just one story.
- **User Stories (Phase 3-6)**: All depend on Foundational completion.
  - US1 (P1) has no dependency on US2/US3/US4 and should be built/validated first (MVP).
  - US2 (P1) depends on US1's route file existing (`tenant-department-routes.ts`, T010) to add
    `POST`/`PATCH`/the new `GET /tenant/users` alongside the existing `GET`, and on US1's client
    component (T014) to add the create/edit UI into — not independent of US1's *files*, but
    independently *testable* per its own acceptance scenarios once US1 is in place.
  - US3 (P2) similarly extends US1/US2's same route file and client component; independently testable
    via its own delete/archive scenarios.
  - US4 (P3) touches an entirely different existing file (`tenant-team-routes.ts` /
    `team-settings-client.tsx`) and only depends on Foundational's `users.department_id` (T005) plus
    US1's list endpoint (T010) for its Active-departments query — not on US2/US3 at all.
- **Polish (Phase 7)**: Depends on every story being complete.

### Within Each User Story

- Tests (T009, T016-T018, T025-T028) are written before their corresponding implementation task and
  should fail until that task lands.
- Route/schema logic before the client UI that calls it.
- Story complete and checkpoint-validated before moving to the next priority.

### Parallel Opportunities

- T002, T003 (Setup) in parallel with T001.
- T006, T008 (Foundational) in parallel with T004/T005 (different files, no shared dependency).
- T009 (US1 test) can be written in parallel with T010-T015 (implementation), per the standard
  tests-before-implementation ordering within the story.
- T016, T017, T018 (US2 tests) in parallel with each other.
- T025, T026, T027, T028 (US3 tests) in parallel with each other.
- US4 (T032-T033) can be built in parallel with US2/US3 by a different contributor once Foundational
  is done, since it touches entirely different files.

---

## Parallel Example: Foundational Phase

```bash
# T004 and T005 touch different schema files and can proceed in parallel with T006 and T008:
Task: "Alter departments schema in apps/api/src/db/schema/departments.ts"
Task: "Alter users schema in apps/api/src/db/schema/users.ts"
Task: "Seed department.view/department.manage permissions migration"
Task: "Add Modal primitive in packages/ui/src/modal.tsx"
```

## Parallel Example: User Story 3 Tests

```bash
Task: "Integration test: delete blocked by members in apps/api/tests/integration/department-delete-blocked-members.test.ts"
Task: "Integration test: delete blocked by children in apps/api/tests/integration/department-delete-blocked-children.test.ts"
Task: "Integration test: archive succeeds where delete is blocked in apps/api/tests/integration/department-archive-alternative.test.ts"
Task: "Integration test: delete succeeds despite Manager/Assistant Manager assignment in apps/api/tests/integration/department-manager-assignment.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational — schema (including Manager/Assistant Manager columns),
   permissions, hierarchy helpers, `Modal` primitive.
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: run quickstart.md §2 and §7.1 (view + permission gating) independently.
5. Demo: a real, searchable, permission-gated department hierarchy — even with no create/edit/delete
   yet (departments visible are whatever provisioning seeded, per Spec 002).

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. User Story 1 → validate independently → demoable (MVP).
3. User Story 2 → validate independently (quickstart.md §3-§4) → demoable.
4. User Story 3 → validate independently (quickstart.md §5) → demoable.
5. User Story 4 → validate independently (quickstart.md §6) → demoable.
6. Polish → full quickstart.md pass, no regression in existing RLS/role-deletion suites.

### Parallel Team Strategy

1. One contributor completes Setup + Foundational (schema/permissions/hierarchy-helpers/Modal) —
   this genuinely blocks everyone else.
2. Once Foundational lands:
   - Contributor A: User Story 1 → then User Story 2 → then User Story 3 (same route file/client
     component, natural continuation).
   - Contributor B: User Story 4 (different files entirely — `tenant-team-routes.ts` /
     `team-settings-client.tsx`) — only needs T005 and T010 from the other track.
3. Polish once all stories land.
