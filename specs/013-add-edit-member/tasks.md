# Tasks: Add/Edit Team Member

**Input**: Design documents from `specs/013-add-edit-member/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/add-edit-member-api.md, quickstart.md

**Tests**: Included — this codebase's established convention (every prior spec) is real-Postgres
Vitest integration tests for every validation/permission-gating behavior, not mocked.

**Organization**: Tasks are grouped by user story (spec.md's own P1–P3 priority order) so each story
is independently completable and testable.

## Path Conventions

Existing monorepo: `apps/api/src/tenant-auth`, `apps/api/tests/integration`, `apps/api/drizzle`,
`apps/web/app/(dashboard-shell)/settings/team` — matching plan.md's Project Structure exactly.

---

## Phase 1: Setup

- [X] T001 Confirm working tree is clean on branch `013-add-edit-member` (already created from a
      fully-merged `master`) — no project scaffolding needed, this is an existing monorepo.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The role/department validation logic and dropdown data-fetching that both the create
(US1) and edit (US2) forms share.

**⚠️ CRITICAL**: No user story task can begin until this phase is complete.

- [X] T002 Create `apps/api/src/tenant-auth/team-write-validation.ts` exporting
      `roleExists(tenantDb, roleId): Promise<boolean>` and `departmentIsActive(tenantDb,
      departmentId): Promise<boolean>` — both simple existence checks scoped to the caller's tenant
      via RLS (research.md §1), reused by the `POST` fix (US1) and the new `PATCH` route (US2).
- [X] T003 [P] In `apps/web/app/(dashboard-shell)/settings/team/team-settings-client.tsx`, add: (a) a
      fetch of `GET /tenant/roles` populating a `RoleOption[]` state (id, name), and (b) a
      `departmentPath(departmentId, allDepartments): string` helper that walks `parentDepartmentId`
      against the already-fetched flat department list to build "Engineering > Backend"-style paths
      (research.md §3, mirroring Department's own ancestor-walking technique) — both reused by the
      create and edit forms in later phases.

**Checkpoint**: Foundation ready — shared validation helper and dropdown data sources exist.

---

## Phase 3: User Story 1 - Admin creates a member with a working role picker and department assignment (Priority: P1) 🎯 MVP

**Goal**: Fix the free-text "Role ID" bug (today an invalid id causes an uncaught 500 after the user
row is already committed) and add a proper Department field, both in a slide-out drawer replacing
the always-visible inline form.

**Independent Test**: Open "Add member," confirm it's a drawer, select a role and an Active
department by name (never a raw id), submit, and confirm the created member has exactly that
role/department. Directly `POST` an invalid `roleId` and confirm a clean `422`, with no user row
left behind.

### Tests for User Story 1

- [X] T004 [P] [US1] Integration test in
      `apps/api/tests/integration/tenant-team-create-validation.test.ts`: `POST /tenant-auth/team`
      with a `roleId` that doesn't exist in the tenant returns `422` with message "Role not found",
      and no `users` row for that email exists afterward (confirms validation happens before any
      write, research.md §1 — no orphaned row).
- [X] T005 [P] [US1] In the same test file: `POST` with an archived department's id, and with a
      different tenant's department id, both return `422 "Department not found or not active"`
      before any write.

### Implementation for User Story 1

- [X] T006 [US1] In `apps/api/src/tenant-auth/tenant-team-routes.ts`'s `POST /tenant-auth/team`
      handler, call `roleExists`/`departmentIsActive` (T002) before the `users` insert; return the
      `422` responses per `contracts/add-edit-member-api.md`. (depends on T002)
- [X] T007 [US1] In `team-settings-client.tsx`: replace the always-visible "Add a team member"
      inline section with a "+ Add member" button (visible when `canAddMember`, matching Department's
      own Create-button pattern) that opens a new shared Create/Edit `Drawer` containing Full name,
      Email, a searchable Role dropdown (populated via T003, storing the role's actual id), and a
      searchable Department dropdown (Active-only, showing the hierarchy path via T003's helper);
      wire submission to `POST /tenant-auth/team`, refreshing the directory (`loadMembers()`) on
      success. (depends on T003, T006)

**Checkpoint**: User Story 1 is fully functional and independently testable — creating a member with
a real role and an optional, correctly-validated department works end-to-end in a drawer.

---

## Phase 4: User Story 2 - Admin edits an existing member's role and department (Priority: P2)

**Goal**: Add the edit capability that does not exist anywhere in the product today, reusing the same
form built in User Story 1.

**Independent Test**: As a `team.edit`/`manage_team_members` holder, open a member's profile, click
"Edit," change their department, save, and confirm the directory/profile reflect it immediately. As
a view-only holder, confirm no "Edit" action is reachable at all.

### Tests for User Story 2

- [X] T008 [P] [US2] Integration test in `apps/api/tests/integration/tenant-team-edit.test.ts`:
      `PATCH /tenant/team/:userId` updates `fullName`/`roleId`/`departmentId` correctly (role
      reassignment via the single-row `user_roles` update, research.md §2); a `departmentId: null`
      body clears the assignment; an omitted field leaves it untouched.
- [X] T009 [P] [US2] Integration test in
      `apps/api/tests/integration/tenant-team-edit-permission-gating.test.ts`: `403` for a caller
      holding only `team.view.all`/`team.view.department`; `200` for a caller holding
      `manage_team_members` or the new `team.edit`; `404` for a `userId` that doesn't exist in the
      caller's tenant.
- [X] T010 [P] [US2] In `tenant-team-edit.test.ts`: `PATCH` with an invalid `roleId` or an
      archived/cross-tenant `departmentId` returns the identical `422` responses `POST` does (T004/
      T005), and leaves the member's existing data unchanged.

### Implementation for User Story 2

- [X] T011 [US2] Migration `apps/api/drizzle/0042_seed_team_edit_permission.sql`: seed `team.edit`
      (category `settings`) into `permissions`, mirroring `0038`/`0040`'s exact `INSERT` shape; grant
      to the HR/L&D Admin role template only (org-wide, per Clarifications — no Manager grant); and
      backfill onto every already-live tenant's HR/L&D Admin-sourced role (matched by
      `source_template_id` and by name, per `0040`'s combined approach). Register in
      `apps/api/drizzle/meta/_journal.json`. Run `pnpm db:migrate` and verify with a direct query.
- [X] T012 [US2] Implement `PATCH /tenant/team/:userId` in `tenant-team-routes.ts`: gate with
      `requireAnyPermission("manage_team_members", "team.edit")`; `404` if the member doesn't exist
      in the caller's tenant; validate role/department (T002) before any write; update `users.full_name`/
      `users.department_id` and `user_roles.role_id` (single-row update) for supplied fields only;
      return the same row shape `GET /tenant/team` returns (per `contracts/add-edit-member-api.md`).
      (depends on T002)
- [X] T013 [US2] In `team-settings-client.tsx`: widen `page.tsx` to compute and pass `canEditMember =
      permissions.includes("manage_team_members") || permissions.includes("team.edit")`; add an
      "Edit member" button to the existing read-only profile `Drawer` (visible only when
      `canEditMember`) that closes the profile drawer and opens the Create/Edit `Drawer` from T007 in
      edit mode — pre-filled with that member's current full name, role, and department — submitting
      via `PATCH` instead of `POST` on save. (depends on T007, T012)

**Checkpoint**: User Stories 1 and 2 both work independently — creating and editing a member's role/
department are both correct, and edit access is properly gated.

---

## Phase 5: User Story 3 - Tenant's own custom fields appear in the create/edit form (Priority: P3)

**Goal**: Render and validate that tenant's configured "member" custom fields dynamically in the same
create/edit form, in their configured display order.

**Independent Test**: Configure two custom fields for "member," one required; open the create form
and confirm both render in order; submit without the required one and confirm a field-level error;
fill both, save, then reopen in edit mode and confirm both values are pre-filled.

### Tests for User Story 3

- [X] T014 [P] [US3] Integration test in
      `apps/api/tests/integration/tenant-team-custom-fields.test.ts`: `POST`/`PATCH` with a missing
      required custom field returns `422 { errors: [...] }` identifying that field, before any write;
      valid values are written and retrievable via the existing `GET /tenant/custom-field-values`
      afterward.

### Implementation for User Story 3

- [X] T015 [US3] In `tenant-team-routes.ts`'s `POST` and `PATCH` handlers, call `getFormFields(tenantDb,
      "member")` + `validateCustomFieldValues` before any write (alongside T006/T012's own
      validation) and `writeCustomFieldValues` after the user/role write succeeds, mirroring
      Department's own established order exactly (research.md §5). (depends on T006, T012)
- [X] T016 [US3] In `team-settings-client.tsx`: widen the existing `MemberCustomField` interface with
      `fieldType`, `isRequired`, `options`, `displayOrder`; add a `renderCustomField`/`renderFormField`
      dispatcher mirroring Department's own per-`field_type` rendering (`text`/`textarea`/`number`/
      `date`/`select`/`multiselect`) with inline field-level error display; render these dynamically,
      in `displayOrder`, below Full name/Email/Role/Department in the shared Create/Edit `Drawer` from
      T007/T013, for both create and edit. (depends on T007, T013, T015)

**Checkpoint**: All three user stories are independently functional — the full spec is implemented.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T017 [P] Run `pnpm --filter api --filter web exec tsc --noEmit`; fix any type errors.
- [X] T018 [P] Run the full `apps/api` Vitest suite (`pnpm vitest run`); confirm 100% pass, no
      regressions in any pre-existing test.
- [X] T019 Run a full production build (`pnpm build` in `apps/web`); confirm no ESLint/TypeScript
      errors.
- [X] T020 Execute every scenario in `quickstart.md` live in the browser, across an authorized admin
      and a view-only user; verify the negative cases (invalid role/department, unauthorized edit);
      clean up any test members/roles created purely for verification.
- [X] T021 Mark all tasks above `[X]` as they complete.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS every user story (both the create and edit
  routes share the same validation helper; both forms share the same dropdown data sources).
- **User Story 1 (Phase 3)**: Depends on Foundational only. This is the MVP — the fixed create form.
- **User Story 2 (Phase 4)**: Depends on Foundational + User Story 1 (extends the same shared
  Create/Edit `Drawer` built in US1, and reuses T002's validation helper) — independently testable
  via its own dedicated tests and checkpoint.
- **User Story 3 (Phase 5)**: Depends on Foundational + User Story 1 + User Story 2 (adds custom-field
  rendering/validation to both the `POST` and `PATCH` handlers and the one shared form).
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Parallel Opportunities

- T004 and T005 (US1's two test assertions, same file) can be written together; T008/T009/T010 (US2's
  three test files) can run in parallel with each other.
- T002 and T003 (Foundational) touch different files (backend helper vs. frontend) and can proceed in
  parallel.
- US2 and US3's backend tasks (T012, T015) both touch the same handler file and should be implemented
  sequentially, not truly in parallel, despite being independently designed and tested.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (trivial) + Phase 2 (Foundational — validation helper, dropdown data sources).
2. Complete Phase 3 (User Story 1) — the Role/Department bug fix, in a drawer.
3. **STOP and VALIDATE**: creating a member with a real role and an optional Active department works,
   and an invalid role/department is cleanly rejected. This alone is demoable and ships real value.

### Incremental Delivery

1. Foundational → Phase 3 (US1, MVP) → demo.
2. Phase 4 (US2) → demo — editing an existing member's role/department, gated correctly.
3. Phase 5 (US3) → demo — the tenant's own custom fields appear dynamically in both forms.
4. Phase 6 (Polish) → full verification pass, ship.
