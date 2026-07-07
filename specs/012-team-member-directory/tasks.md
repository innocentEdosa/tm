# Tasks: Team Member Directory (List View)

**Input**: Design documents from `specs/012-team-member-directory/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/team-directory-api.md, quickstart.md

**Tests**: Included — this codebase's established convention (every prior spec) is real-Postgres
Vitest integration tests for every permission-gating/visibility-scoping behavior, not mocked.

**Organization**: Tasks are grouped by user story (spec.md's own P1–P4 priority order) so each story
is independently completable and testable.

## Path Conventions

Existing monorepo: `apps/api/src`, `apps/api/tests/integration`, `apps/api/drizzle`, `apps/web/app`,
`packages/ui/src` — matching plan.md's Project Structure exactly.

---

## Phase 1: Setup

- [X] T001 Confirm working tree is clean on branch `012-team-member-directory` (already created from
      a fully-merged `master`, per plan.md's Constitution Check) — no project scaffolding needed,
      this is an existing monorepo.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared infrastructure every user story depends on — schema, permissions, the visibility
helper, and the one new UI primitive.

**⚠️ CRITICAL**: No user story task can begin until this phase is complete.

- [X] T002 Add nullable `invitedBy` column (`uuid`, FK → `users.id`, `onDelete: "set null"`) to
      `apps/api/src/db/schema/users.ts`, plus migration `apps/api/drizzle/0039_add_users_invited_by.sql`
      (data-model.md "New: users.invited_by"). Register in `apps/api/drizzle/meta/_journal.json`.
- [X] T003 [P] Migration `apps/api/drizzle/0040_seed_team_view_permissions.sql`: seed
      `team.view.all`/`team.view.department` into `permissions` (category `settings`, mirroring
      `0038_seed_granular_crud_permissions.sql`'s exact `INSERT` shape), grant `team.view.all` to the
      HR/L&D Admin role template and `team.view.department` to the Manager role template, and
      backfill both grants onto every already-live tenant role sourced from those templates (matched
      by `source_template_id` and by name, per `0038`'s combined approach). Register in the journal.
- [X] T004 [P] Migration `apps/api/drizzle/0041_seed_member_form_definition.sql`: seed one
      `form_definitions` row (`key = 'member'`), mirroring `0030_seed_department_form_definition.sql`
      exactly. Register in the journal. Run all three new migrations (`pnpm db:migrate` in `apps/api`)
      and verify with a direct query that all rows exist as expected before proceeding.
- [X] T005 [P] Update the existing `POST /tenant-auth/team` handler in
      `apps/api/src/tenant-auth/tenant-team-routes.ts` to set the new member's `invitedBy` to
      `request.user!.id` at creation time (depends on T002).
- [X] T006 [P] Create `apps/api/src/tenant-auth/team-visibility.ts` exporting a function that, given
      `tenantDb` and the requesting user's id, returns the caller's effective visibility scope: `null`
      (no restriction) if the caller holds `team.view.all`; otherwise looks up the caller's own
      `departmentId` and returns `collectSubtreeIds(tenantDb, departmentId)` (reusing the existing
      helper from `apps/api/src/departments/department-hierarchy.ts`, research.md §3/§6), or a
      distinct `"no_department_assigned"` sentinel if the caller's own `departmentId` is `NULL`.
- [X] T007 [P] Create `packages/ui/src/pagination.tsx` — a small controlled component
      (`page`, `pageSize`, `total`, `onPageChange`) rendering an "X–Y of Z" label plus prev/next
      controls (disabled at the first/last page), matching this package's existing visual language
      (research.md §5). Export it from `packages/ui/src/index.ts`.
- [X] T008 Widen the "Members" nav-visibility check in
      `apps/web/app/(dashboard-shell)/layout.tsx` (`canManageTeam`) to also include
      `session.permissions.includes("team.view.all")` and `session.permissions.includes("team.view.department")`,
      alongside the existing `manage_team_members`/`team.create` checks — a pure viewer with no
      create/manage permission must still see the nav entry.

**Checkpoint**: Foundation ready — migrations applied, visibility helper and pagination primitive
exist, nav shows "Members" for any of the four relevant permissions.

---

## Phase 3: User Story 1 - Org-wide admin browses the full team directory (Priority: P1) 🎯 MVP

**Goal**: An org-wide viewer (`team.view.all`) sees every member in the tenant with the five core
columns, and can search by name/email, server-side.

**Independent Test**: Log in as a `team.view.all` holder, open Members, confirm every tenant member
appears across every department, and that typing a search term narrows the list server-side.

### Tests for User Story 1

- [X] T009 [P] [US1] Integration test in `apps/api/tests/integration/tenant-team-list.test.ts`:
      seed members across three departments, assert `GET /tenant/team` for a `team.view.all` holder
      returns all of them with correct `fullName`/`email`/`roleName`/`departmentName`/`accountStatus`
      fields; assert `?search=` narrows results by name and by email, case-insensitively.
- [X] T010 [P] [US1] Integration test in
      `apps/api/tests/integration/tenant-team-list-permission-gating.test.ts`: assert `403` for a
      user holding neither `team.view.all` nor `team.view.department`.

### Implementation for User Story 1

- [X] T011 [US1] Implement `GET /tenant/team` in `apps/api/src/tenant-auth/tenant-team-routes.ts`:
      gate with `requireAnyPermission("team.view.all", "team.view.department")`; join `users` →
      `user_roles` → `roles` (role name) → `departments` (department name, nullable); derive
      `accountStatus` from `mustChangePassword` (`true` → `"invited"`, `false` → `"active"`); apply
      `ILIKE` search on `fullName`/`email` when `?search=` is present; paginate with
      `.limit(pageSize).offset((page-1)*pageSize)` (default `pageSize=25`) plus a `count(*)` query for
      `meta.total`; for a `team.view.all` caller, apply no department restriction (US2/US3 add
      restriction branches on top of this same handler). Response shape per
      `contracts/team-directory-api.md`. (depends on T002–T006)
- [X] T012 [US1] In `apps/web/app/(dashboard-shell)/settings/team/team-settings-client.tsx`, add the
      directory table above/alongside the existing add-member form: heading "Team Members",
      org-wide description line "View and manage everyone in your organization.", search input
      (server-side, debounced), and a table with columns: checkbox (visual only — no bulk action
      wired, per spec.md's own Assumptions), Name (+initial-letter avatar, mirroring `AppShell`'s
      existing identity-avatar pattern), Role, Department, Email, Account status (badge), and
      Edit/Delete icon affordances gated on the existing `manage_team_members` permission (visual
      placeholders only — wiring them to a working edit/delete flow is the companion Add/Edit Member
      spec's responsibility, per spec.md's explicit out-of-scope declaration). Fetch via
      `${API_BASE}/team?subdomain=...&search=...&page=...`.
- [X] T013 [US1] Wire the new `packages/ui/src/pagination.tsx` primitive into the table built in
      T012, driven by the list response's `meta.page`/`meta.pageSize`/`meta.total`. (depends on T007, T011, T012)

**Checkpoint**: User Story 1 is fully functional and independently testable — an org-wide viewer can
browse, search, and page through every member in the tenant.

---

## Phase 4: User Story 2 - Department-scoped manager browses their own team (Priority: P2)

**Goal**: A `team.view.department`-only holder sees only their own department's subtree, enforced
server-side even against a crafted direct API request.

**Independent Test**: Seed a manager scoped to a department with two children, seed members in and
outside that subtree, and confirm both the UI and a direct `GET /tenant/team?departmentId=<outside>`
call return only the manager's own subtree's members.

### Tests for User Story 2

- [X] T014 [P] [US2] Integration test in
      `apps/api/tests/integration/tenant-team-list-department-scope.test.ts`: seed a parent
      department with one child and a third, unrelated department; assert a `team.view.department`
      holder scoped to the parent sees only parent+child members; assert a direct call with
      `?departmentId=<unrelated-id>` still returns only the parent+child subtree (SC-002/SC-004 —
      the security-critical assertion, verified on the raw response body).
- [X] T015 [P] [US2] Integration test in
      `apps/api/tests/integration/tenant-team-list-no-department.test.ts`: a `team.view.department`
      holder whose own `departmentId` is `NULL` gets `meta.reason: "no_department_assigned"` and an
      empty `data` array, not a 500 or a generic empty result.

### Implementation for User Story 2

- [X] T016 [US2] Extend the `GET /tenant/team` handler (T011) using `team-visibility.ts` (T006): for
      a caller holding only `team.view.department`, resolve their scope and apply
      `WHERE department_id IN (...)`; if the scope is the `"no_department_assigned"` sentinel, return
      `200` with `data: []` and `meta.reason: "no_department_assigned"` before running the main query;
      any client-supplied `?departmentId=` is ignored entirely for these callers (never expands or
      redirects their scope). (depends on T006, T011)
- [X] T017 [US2] In `team-settings-client.tsx`, render the department-scoped description line "View
      and manage members of your department." when the viewer lacks `team.view.all`, and a distinct
      "you aren't assigned to a department yet" empty state when `meta.reason ===
      "no_department_assigned"`. (depends on T016)

**Checkpoint**: User Stories 1 and 2 both work independently — org-wide and department-scoped
viewing are both correct, and the security boundary is proven by a direct-API test, not just the UI.

---

## Phase 5: User Story 3 - Org-wide viewer filters the directory by department (Priority: P3)

**Goal**: An org-wide viewer narrows the list to one department (plus its descendants) via a filter
dropdown, visible only to them.

**Independent Test**: Seed a parent department with children and an unrelated department; as an
org-wide viewer, select the parent in the filter and confirm parent+children members appear, others
don't; confirm a department-scoped viewer sees no filter control at all.

### Tests for User Story 3

- [X] T018 [P] [US3] Integration test in
      `apps/api/tests/integration/tenant-team-list-department-filter.test.ts`: as a `team.view.all`
      holder, assert `?departmentId=<parent>` returns parent+child members and excludes the
      unrelated department's members.

### Implementation for User Story 3

- [X] T019 [US3] Extend the `GET /tenant/team` handler (T011/T016): for a `team.view.all` caller
      supplying `?departmentId=`, apply `collectSubtreeIds(departmentId)` as a `WHERE department_id
      IN (...)` restriction (reusing the same helper call shape as T016's own scoping). (depends on T011)
- [X] T020 [US3] In `team-settings-client.tsx`, add a department filter dropdown (populated from the
      existing `GET /tenant/departments`), rendered only when the viewer holds `team.view.all`; wire
      its selection into the list fetch's `?departmentId=` param. (depends on T019)

**Checkpoint**: All three viewing/filtering stories work together — org-wide, department-scoped, and
filtered browsing are all independently correct.

---

## Phase 6: User Story 4 - Viewer clicks a row to see a member's full profile (Priority: P4)

**Goal**: Expanding any row reveals that tenant's configured "member" custom fields plus invite
metadata, with zero hardcoded HR-specific fields anywhere.

**Independent Test**: Configure two custom fields for `member`, set one value on a test member,
click their row, and confirm both fields render in the slide-out panel (one with its value, one with the established muted
empty-state treatment) alongside invited-by/invited-at.

### Tests for User Story 4

- [X] T021 [P] [US4] Integration test in
      `apps/api/tests/integration/tenant-team-invite-metadata.test.ts`: assert `GET /tenant/team`
      rows include `invitedByName` (resolved via a self-join on `users.invitedBy`) and `invitedAt`
      (from `createdAt`); assert a member created before T002's migration (i.e. `invitedBy IS NULL`)
      returns `invitedByName: null` without erroring.

### Implementation for User Story 4

- [X] T022 [US4] Extend the `GET /tenant/team` handler's query (T011) to self-join `users` as
      `inviter` on `users.invitedBy = inviter.id`, adding `invitedByName`/`invitedAt` to each row per
      `contracts/team-directory-api.md`. (depends on T005, T011)
- [X] T023 [US4] In `team-settings-client.tsx`, make each row clickable to open a `Drawer`
      slide-out panel (revised from an inline expandable row per direct product feedback), mirroring
      Department's own detail-view `Drawer` pattern; on open, lazy-fetch
      `GET /tenant/custom-field-values?formKey=member&entityId=<memberId>` (existing, reused route)
      and `GET /tenant/form-fields?formKey=member` (existing, reused route) to render each configured
      field's label + value (or the established muted empty-state placeholder for an unset field,
      never "—"), plus the row's own `invitedByName`/`invitedAt`. Render only system metadata (no
      broken placeholders) when zero custom fields are configured for `member`. (depends on T022)

**Checkpoint**: All four user stories are independently functional — the full spec is implemented.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T024 [P] Run `pnpm --filter api --filter web exec tsc --noEmit`; fix any type errors.
- [X] T025 [P] Run the full `apps/api` Vitest suite (`pnpm vitest run`); confirm 100% pass, no
      regressions in any pre-existing test.
- [X] T026 Run a full production build (`pnpm build` in `apps/web`); confirm no ESLint/TypeScript
      errors and that `/settings/team` registers cleanly.
- [X] T027 Execute every scenario in `quickstart.md` live in the browser (Chrome automation), across
      an org-wide viewer, a department-scoped viewer, and a no-permission user; verify all three
      distinct empty states; clean up any test members/departments/custom-field configuration created
      purely for verification.
- [X] T028 Mark all tasks above `[X]` as they complete.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS every user story (all four stories share the
  same route, the same visibility helper, and the same pagination primitive).
- **User Story 1 (Phase 3)**: Depends on Foundational only. This is the MVP — the base route,
  listing, search, and pagination.
- **User Story 2 (Phase 4)**: Depends on Foundational + User Story 1 (extends the same route handler
  and frontend table built in Phase 3) — not independent of US1's own code, but independently
  *testable* once built (its own dedicated tests, its own checkpoint).
- **User Story 3 (Phase 5)**: Depends on Foundational + User Story 1 (extends the same handler);
  independent of User Story 2 (a different branch of the same query).
- **User Story 4 (Phase 6)**: Depends on Foundational + User Story 1 (extends the same handler and
  table); independent of User Stories 2 and 3.
- **Polish (Phase 7)**: Depends on all four user stories being complete.

### Parallel Opportunities

- T003 and T004 (independent migrations) can run in parallel with each other, and with T005/T006/T007
  (different files, no shared dependency beyond T002 for T005).
- T009 and T010 (US1's two test files) can run in parallel.
- T014 and T015 (US2's two test files) can run in parallel.
- Once Foundational (Phase 2) and US1 (Phase 3) are both complete, US2, US3, and US4 touch the same
  two files (`tenant-team-routes.ts`, `team-settings-client.tsx`) — they are independently
  *designed* and *testable*, but should be implemented sequentially (not truly parallel by different
  people) to avoid merge conflicts within those two shared files.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (trivial) + Phase 2 (Foundational — migrations, visibility helper, pagination
   primitive, nav gating).
2. Complete Phase 3 (User Story 1) — org-wide directory with search and pagination.
3. **STOP and VALIDATE**: an org-wide viewer can browse and search the full directory. This alone is
   demoable.

### Incremental Delivery

1. Foundational → Phase 3 (US1, MVP) → demo.
2. Phase 4 (US2) → demo — department-scoped security boundary proven.
3. Phase 5 (US3) → demo — department filter for org-wide viewers.
4. Phase 6 (US4) → demo — slide-out profile panel with dynamic custom fields, the feature's differentiator.
5. Phase 7 (Polish) → full verification pass, ship.
