# Tasks: Roles Management UI

**Input**: Design documents from `/specs/011-roles-management-ui/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — plan.md's Project Structure and Testing sections commit to five new Vitest
integration test files mirroring this codebase's existing RLS/permission-gating convention (real
Postgres, no mocks).

**Organization**: Tasks are grouped by user story (spec.md) to enable independent implementation and
testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)
- Exact file paths are included in every task

## Path Conventions

Existing pnpm/Turborepo monorepo (plan.md Project Structure) — no new top-level project:
- Backend: `apps/api/src/permissions/...`, `apps/api/tests/integration/...`
- Frontend: `apps/web/app/(dashboard-shell)/...`

---

## Phase 1: Setup

**Purpose**: Scaffold the new frontend route directory. No new dependency, no new migration (plan.md
— the system-role guard is an application-layer check, not schema/RLS work).

- [X] T001 Create the new frontend route directory
      `apps/web/app/(dashboard-shell)/settings/roles/`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The two new read endpoints and the system-role guard every user story depends on —
US1 needs the list endpoint to render anything at all; US2 needs the catalog endpoint for its
checklist; US3/US4 need both the list (for member counts) and the guard added to the existing
PATCH/DELETE handlers.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 Implement `apps/api/src/permissions/role-member-counts.ts`: exports
      `getRoleMemberCounts(tenantDb)` returning a `Map<roleId, count>` via
      `SELECT role_id, count(*) FROM user_roles GROUP BY role_id` scoped by the caller's own
      `request.tenantDb` (RLS already limits this to the caller's own tenant — data-model.md).
- [X] T003 Implement `GET /tenant/roles` in `apps/api/src/permissions/tenant-role-routes.ts`, gated
      `requirePermission("manage_roles")` (matching this file's own existing single-preHandler
      convention): selects every role visible to the tenant, joins `role_permissions`/`permissions`
      for each role's `permissionKeys`, computes `isSystem` as `sourceTemplateId !== null`, and
      attaches `memberCount` from T002's `getRoleMemberCounts`. Response shape per
      contracts/tenant-roles-management-api.md.
- [X] T004 Implement `GET /tenant/permission-catalog` in `tenant-role-routes.ts`, gated
      `requirePermission("manage_roles")`: selects every row from `permissions` (`id`, `key`,
      `displayName`, `description`, `category`) via `request.tenantDb`, flat (no server-side
      grouping — data-model.md/research.md §4).
- [X] T005 Add the system-role guard to the existing `PATCH /tenant/roles/:roleId` handler in
      `tenant-role-routes.ts`: after the existing "not found" check and before any write, if the
      resolved role's `sourceTemplateId` is not null, return `403 { success: false, message:
      "System roles cannot be modified." }` (research.md §2, data-model.md).
- [X] T006 Add the identical system-role guard to the existing `DELETE /tenant/roles/:roleId`
      handler in `tenant-role-routes.ts`, checked *before* the existing member-assignment
      (`23503`/`409`) check, so a system role with zero members still correctly reports "cannot be
      modified" rather than silently succeeding (contracts/tenant-roles-management-api.md).

**Checkpoint**: Foundation ready — both new read endpoints exist, and system roles are provably
unmodifiable via direct API calls, not just hidden in the UI.

---

## Phase 3: User Story 1 - See every role at a glance (Priority: P1) 🎯 MVP

**Goal**: A user holding `manage_roles` opens Administration > Roles and sees every system and custom
role together, each with an accurate member count and a clear System/Custom distinction.

**Independent Test**: As a user holding `manage_roles`, open Administration > Roles and confirm every
tenant role appears exactly once, with a "System" badge and disabled Edit/Delete on built-in roles,
and active controls on custom roles.

### Tests for User Story 1

- [X] T007 [P] [US1] Integration test: `GET /tenant/roles` returns every tenant role (system and
      custom) with correct `isSystem`, `memberCount`, and `permissionKeys`, in
      `apps/api/tests/integration/tenant-roles-list.test.ts`.

### Implementation for User Story 1

- [X] T008 [US1] Create the Server Component route guard
      `apps/web/app/(dashboard-shell)/settings/roles/page.tsx` (mirrors
      `settings/department/page.tsx`). Depends on T001.
- [X] T009 [US1] Build `apps/web/app/(dashboard-shell)/settings/roles/roles-settings-client.tsx`:
      fetch `GET /tenant-api/tenant/roles`, render in a `Card` (`@tm/ui`) table with columns Role
      name, Description, Member count, Type (a "System" `Badge` for `isSystem` rows), and Actions;
      system rows render their Edit/Delete controls disabled with a `title` tooltip "System roles
      cannot be modified" (not hidden entirely, matching FR-004's exact wording); custom rows use the
      `RowActionsMenu` kebab pattern already established in `department-settings-client.tsx`. Include
      a "Create role" `Button` (wired in US2). Depends on T003, T008.
- [X] T010 [US1] In `apps/web/app/(dashboard-shell)/layout.tsx`: change the existing disabled
      `"roles"` nav entry (currently `disabled: true, tag: "Soon"`) into a real, active link, gated
      on a new `canManageRoles = session.permissions.includes("manage_roles")` check rather than the
      broader `canManageTeam || canViewDepartments` condition the `administrationChildren` array
      currently shares (spec FR-015/Assumptions). Leave the `"permission"` entry untouched here (US5
      removes it separately).

**Checkpoint**: User Story 1 is fully functional and independently testable — a tenant admin can see
every role and its member count, even before create/edit/delete exist.

---

## Phase 4: User Story 2 - Create a custom role with specific permissions (Priority: P1)

**Goal**: A user holding `manage_roles` creates a custom role, selecting permissions from a checklist
generated entirely from the live permission catalog, grouped by category.

**Independent Test**: Create a role named "Content Reviewer" with only `edit_content_library` checked,
save, and confirm it appears in the list as Custom with that one permission.

### Tests for User Story 2

- [X] T011 [P] [US2] Integration test: `GET /tenant/permission-catalog` returns every permission with
      its `category`, in `apps/api/tests/integration/tenant-roles-permission-catalog.test.ts`.

### Implementation for User Story 2

- [X] T012 [US2] Extend `roles-settings-client.tsx`: on "Create role" click, fetch
      `GET /tenant-api/tenant/permission-catalog`, group the flat list by `category` client-side, and
      open a `Drawer` (`@tm/ui`, right side, matching Department's create/edit pattern) with Name
      (`Input`, required), Description (`textarea`), and the grouped permission checklist — each
      group collapsible/expandable with a "select all in group" checkbox that checks/unchecks only
      that group's items, each permission item showing its `displayName` and `description`. Submits
      via the existing `POST /tenant-api/tenant/roles` with `{ name, description, permissionKeys }`.
      Depends on T004, T009.
- [X] T013 [US2] Add client-side duplicate-name checking (inline, against the already-fetched role
      list) before submit, and surface the server's own `409 "Role name already exists"` message if
      it still occurs (FR-014 — frontend validation mirrors, never replaces, server enforcement).
      Depends on T012.

**Checkpoint**: User Stories 1 AND 2 both work independently — the framework is usable end-to-end for
creating and viewing custom roles.

---

## Phase 5: User Story 3 - Edit a custom role, with a clear warning if people are already using it (Priority: P2)

**Goal**: Editing a custom role with zero members saves immediately; editing one with N ≥ 1 members
shows an impact-warning dialog stating the exact count before saving.

**Independent Test**: Edit a custom role with zero members (saves immediately, no dialog); assign a
member to a custom role, edit it, and confirm the impact-warning dialog blocks saving until confirmed.

### Tests for User Story 3

- [X] T014 [P] [US3] Integration test: a `manage_roles` user's `PATCH` attempt against a system role
      is rejected `403` even via a direct API call (not just hidden in the UI), in
      `apps/api/tests/integration/tenant-roles-system-role-protection.test.ts`. (This same file also
      covers the `DELETE` guard for User Story 4, since both guards share one migration-free
      mechanism — research.md §2.)
- [X] T015 [P] [US3] Integration test: `GET /tenant/roles`'s `memberCount` for a custom role with
      real assigned members (via `user_roles`) is accurate immediately after assignment, in
      `apps/api/tests/integration/tenant-roles-edit-impact-warning.test.ts` — the frontend's decision
      to show the dialog is entirely driven by this already-fetched count, so its accuracy is what
      this test actually needs to prove (contracts/tenant-roles-management-api.md).

### Implementation for User Story 3

- [X] T016 [US3] Wire the Edit action in `roles-settings-client.tsx`: opens the same Drawer from T012,
      pre-filled with the role's current `name`/`description`/`permissionKeys`; on submit, if the
      role's `memberCount` (from the already-fetched list) is ≥ 1, open a `Modal` (`@tm/ui`) stating
      "This role is assigned to N member(s). Changes to its permissions will take effect for them
      immediately. Continue?" with Confirm/Cancel — only calling `PATCH /tenant-api/tenant/roles/
      :roleId` on Confirm; if `memberCount` is 0, call `PATCH` immediately with no dialog. Depends on
      T005, T012.

**Checkpoint**: All P1/P2-so-far user stories work independently — editing a custom role behaves
correctly whether or not it currently has members, and system roles remain provably unreachable for
edits.

---

## Phase 6: User Story 4 - Delete a custom role that's no longer needed (Priority: P2)

**Goal**: Deleting a custom role with assigned members is blocked with an exact count and a link
toward the Members list; deleting one with zero members succeeds immediately. No delete action exists
anywhere for system roles.

**Independent Test**: Attempt to delete a custom role with assigned members (blocked, with count and a
link); delete a custom role with zero members (removed immediately).

### Tests for User Story 4

- [X] T017 [P] [US4] Integration test: `DELETE /tenant/roles/:roleId` returns `409` with members
      assigned and `204` with zero, in
      `apps/api/tests/integration/tenant-roles-delete-blocked.test.ts`.

### Implementation for User Story 4

- [X] T018 [US4] Wire the Delete action in `roles-settings-client.tsx` (via the same
      `RowActionsMenu` kebab used for Edit, custom rows only — system rows never render a delete
      action at all, per FR-004, already satisfied by T009): call
      `DELETE /tenant-api/tenant/roles/:roleId`; on `409`, show a blocking `Modal` with the exact
      `memberCount` (from the already-fetched list, not the `409` body) and the message "This role is
      assigned to N member(s). Reassign them to a different role before deleting," with a link to
      `/settings/team?role=:roleId` (mirrors Department's `membersListHref` pattern exactly, spec
      Assumptions); on success (`204`), remove the role from the list immediately. Depends on T006,
      T009.

**Checkpoint**: All P1/P2 user stories work independently — role deletion is safe and its blocking
message is accurate.

---

## Phase 7: User Story 5 - "Permission" disappears as its own nav item (Priority: P3)

**Goal**: The standalone "Permission" sidebar entry is removed entirely; "Roles" remains as the one,
fully functional entry point for everything it used to represent.

**Independent Test**: Open the sidebar and confirm "Roles" is active under Administration while no
"Permission" entry exists anywhere, for any user.

### Implementation for User Story 5

- [X] T019 [US5] In `apps/web/app/(dashboard-shell)/layout.tsx`: remove the `"permission"` entry
      from the `administrationChildren` array entirely (FR-016/SC-006). Depends on T010.

**Checkpoint**: All five user stories are independently functional. The feature is complete against
spec.md.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Full end-to-end validation across every story and confirmation of no regression to
Spec 001's existing role-mutation behavior.

- [X] T020 [P] Re-run the existing Spec 001 integration tests covering `POST`/`PATCH`/
      `DELETE /tenant/roles/:roleId` unchanged, confirming the new system-role guard and new read
      endpoints introduce no regression to existing custom-role behavior.
- [X] T021 Run every scenario in `specs/011-roles-management-ui/quickstart.md` end-to-end and fix any
      discrepancy found.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **BLOCKS all user stories** — the two new read
  endpoints and the system-role guard are read by every story, not just one.
- **User Stories (Phase 3-7)**: All depend on Foundational completion.
  - US1 (P1) has no dependency on US2/US3/US4/US5 and should be built/validated first (MVP).
  - US2 (P1) depends on US1's client component (`roles-settings-client.tsx`, T009) already existing
    to extend, and on the Foundational catalog endpoint (T004) — otherwise independently testable via
    its own create scenario.
  - US3 (P2) and US4 (P2) both extend the same client component and both depend on their respective
    Foundational guard (T005/T006) — independently testable via their own edit/delete scenarios once
    US2's Drawer exists (US3 reuses it) and US1's list/kebab exist (US4 reuses it).
  - US5 (P3) depends on US1's nav change (T010) landing first, since it edits the same
    `administrationChildren` array — otherwise a pure, isolated one-line removal.
- **Polish (Phase 8)**: Depends on every story being complete.

### Within Each User Story

- Tests (T007, T011, T014-T015, T017) are written before their corresponding implementation task and
  should fail until that task lands.
- Route/schema logic before the client UI that calls it.
- Story complete and checkpoint-validated before moving to the next priority.

### Parallel Opportunities

- T002 and (T003, T004) in Foundational: T002 must land before T003 (T003 calls
  `getRoleMemberCounts`), but T004 is fully independent of both and can be built in parallel.
- T005 and T006 (the two guard additions) touch the same file but different handlers — sequential in
  practice to avoid merge conflicts, though logically independent.
- T007 (US1 test) can be written in parallel with T008-T010 (implementation), per the standard
  tests-before-implementation ordering within the story.
- T014 and T015 (US3 tests) in parallel with each other.
- US3 (T014-T016) and US4 (T017-T018) can be built in parallel by different contributors once US1/US2
  land, since their tests are independent (though both extend the same client component, so
  coordinate merge order).

---

## Parallel Example: Foundational Phase

```bash
# T004 has no dependency on T002/T003 and can be authored in parallel:
Task: "Implement GET /tenant/permission-catalog in tenant-role-routes.ts"
Task: "Implement role-member-counts.ts, then GET /tenant/roles in tenant-role-routes.ts"
```

## Parallel Example: User Story 3 Tests

```bash
Task: "Integration test: system-role PATCH/DELETE rejected 403 in apps/api/tests/integration/tenant-roles-system-role-protection.test.ts"
Task: "Integration test: accurate memberCount after assignment in apps/api/tests/integration/tenant-roles-edit-impact-warning.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational — both new read endpoints, both system-role guards.
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: run quickstart.md §1-§2 (confirm endpoints/guard, confirm the list view)
   independently.
5. Demo: every system and custom role visible with accurate member counts, system roles visibly
   locked — even before create/edit/delete exist.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. User Story 1 → validate independently → demoable.
3. User Story 2 → validate independently (quickstart.md §3) → demoable (MVP-complete: view + create).
4. User Story 3 → validate independently (quickstart.md §4) → demoable.
5. User Story 4 → validate independently (quickstart.md §5) → demoable.
6. User Story 5 → validate independently (quickstart.md §6) → demoable.
7. Polish → full quickstart.md pass, no regression in Spec 001's existing role-mutation tests.

### Parallel Team Strategy

1. One contributor completes Setup + Foundational (both endpoints + both guards) — this genuinely
   blocks everyone else.
2. Once Foundational lands:
   - Contributor A: User Story 1 → then User Story 5 (same nav file, natural continuation).
   - Contributor B: User Story 2 → then User Story 3 (same Drawer component, natural continuation).
   - Contributor C: User Story 4 (same client component as A/B, but a different action/Modal —
     coordinate merge order).
3. Polish once all stories land.
