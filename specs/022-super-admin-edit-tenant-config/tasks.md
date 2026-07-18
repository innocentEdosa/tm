---

description: "Task list for implementing the Super Admin Edit Tenant Configuration feature"
---

# Tasks: Super Admin Edit Tenant Configuration

**Input**: Design documents from `/specs/022-super-admin-edit-tenant-config/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md,
data-model.md, contracts/ (`super-admin-edit-tenant-config-api.md`), quickstart.md

**Tests**: Included — matching this repo's established precedent for anything touching Super Admin
cross-tenant access (Specs 020/021). This feature's core risks are (a) four separate sets of new,
explicitly-tenant-filtered validation helpers (research.md §1) — a regression in any one would
silently let a role/department/manager/field-key from the *wrong* tenant validate — and (b) the
custom-fields surface's global-field exclusion, which is enforced entirely by this feature's own
query filter rather than RLS (research.md §2) — both are exactly the class of bug that must be proven
against a real Postgres connection, not assumed from reading the code. Test tasks are not optional in
this feature.

**Dependency sign-off status**: None needed — this feature adds no new package (research.md, plan.md
Technical Context). No task in this list should run `pnpm add`.

## Format: `[ID] [P?] [Story?] Description with file path (Backend-only | Frontend — needs UI-UX-Pro-Max skill)`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Maps the task to its user story (US1–US4); Setup/Foundational/Polish tasks carry no
  story label

---

## Phase 1: Setup

- [X] T001 Create and check out branch `022-super-admin-edit-tenant-config` from a clean `master`
  (Constitution Principle X; plan.md Constitution Check flagged this as pending). (Backend-only)
- [X] T002 [P] Confirm no new dependencies are required for this feature (research.md, plan.md
  Technical Context) — a documentation/gate check, not a code change. (Backend-only)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The new audit-log table (needed by US2–US4) and the shared error types every surface's
handler needs.

- [X] T003 Create `apps/api/src/db/schema/tenant-config-action-log.ts`: `tenantConfigActionLog` table
  — `id` (uuid PK), `tenantId` (uuid, FK → `tenants.id` ON DELETE SET NULL), `superAdminId` (uuid, FK
  → `super_admins.id` ON DELETE SET NULL), `entityType` (text NOT NULL, check constraint
  `'role' | 'department' | 'custom_field'`), `entityId` (uuid NOT NULL, no FK — polymorphic, same
  reasoning as `custom_field_values.entity_id`), `action` (text NOT NULL), `createdAt` — per
  data-model.md, mirroring `member-action-log.ts`'s shape. (Backend-only)
- [X] T004 Write migration `apps/api/drizzle/0065_tenant_config_action_log_table.sql`: `CREATE TABLE
  tenant_config_action_log` + its three FK constraints, mirroring
  `0057_member_action_log_table.sql` exactly (research.md §3). Depends on T003. (Backend-only)
- [X] T005 Write migration `apps/api/drizzle/0066_lock_tenant_config_action_log_grants.sql`:
  `GRANT SELECT, INSERT ON tenant_config_action_log TO tm_app;` (no UPDATE/DELETE — append-only),
  mirroring `0058_lock_member_action_log_grants.sql` exactly. Depends on T004. (Backend-only)
- [X] T006 Amend `apps/api/src/super-admin-tenant-console/errors.ts`: add `SystemRoleError` (403),
  `RoleInUseError` (409), `RoleNameConflictError` (409), `DepartmentValidationError` (422, carries a
  `message` for the hierarchy/manager cases in contracts.md), `DepartmentNameConflictError` (409),
  `FieldKeyConflictError` (409), and `RecordNotFoundError` (404, generic — a role/department/field id
  that doesn't resolve scoped to the target tenant) — per contracts/
  `super-admin-edit-tenant-config-api.md`'s error cases for all four surfaces. (Backend-only)
- [X] T007 [P] Create `apps/api/src/super-admin-tenant-console/tenant-config-action-log.ts`:
  `logTenantConfigAction(db, params: { tenantId, superAdminId, entityType, entityId, action })` — a
  single-row insert into `tenant_config_action_log`, reused by the role/department/custom-field
  handlers (US2–US4). Depends on T003. (Backend-only)

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Edit an Existing Member's Role, Department, and Status (Priority: P1) 🎯 MVP

**Goal**: A Super Admin can edit an existing member's full name, role, department, custom field
values, and archived status, for any tenant, from the console's Members tab — reversing Spec 020's
FR-014 for members.

**Independent Test**: From the console's Members tab, open an existing member, change their role and
department, save, and confirm the change is reflected immediately in that tenant's own Team
Directory.

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T008 [P] [US1] Integration test: `PATCH /tenants/:id/members/:memberId` with a valid role
  change returns `200`, updates `user_roles`, and is visible via both `GET /tenants/:id/members`
  (Spec 020) and the tenant-side `GET /tenant/team` (Spec 012) — in
  `apps/api/tests/integration/super-admin-edit-member.test.ts`.
- [X] T009 [P] [US1] Integration test: a `roleId`/`departmentId` not belonging to `:id`'s tenant is
  rejected `422` — the cross-tenant-leak regression research.md §1 flags — in
  `apps/api/tests/integration/super-admin-edit-member-validation.test.ts`.
- [X] T010 [P] [US1] Integration test: `archived: true` on a member who is currently a department's
  Manager or Assistant Manager is rejected `422` with the reassign-first message; `archived: true` on
  an ordinary member succeeds — in
  `apps/api/tests/integration/super-admin-edit-member-archive.test.ts`.
- [X] T011 [P] [US1] Integration test: `customFieldValues` submitted for the "member" form are
  validated and persisted to `custom_field_values`, and an invalid value returns `422` with no write
  — in `apps/api/tests/integration/super-admin-edit-member-custom-fields.test.ts`.
- [X] T012 [P] [US1] Integration test: a successful edit writes exactly one `member_action_log` row
  with `action: "member_edited"` — in
  `apps/api/tests/integration/super-admin-edit-member-action-log.test.ts`.
- [X] T013 [P] [US1] Integration test: `404` for a nonexistent `:memberId` and for a `:memberId`
  belonging to a different tenant than `:id`; `401` without a Super Admin session — in
  `apps/api/tests/integration/super-admin-edit-member-forbidden.test.ts`.

### Implementation for User Story 1

- [X] T014 [US1] Implement `apps/api/src/super-admin-tenant-console/edit-tenant-member.ts`:
  `editTenantMember(db, params)` — reuses Spec 021's `roleExistsForTenant`/
  `departmentIsActiveForTenant` (`add-tenant-member.ts`), a new local
  `isDepartmentLeaderForTenant(db, tenantId, userId)` (tenant-scoped equivalent of
  `isDepartmentLeader`, research.md §1), and tenant-scoped `getFormFields`/
  `validateCustomFieldValues`/`writeCustomFieldValues` calls for the `"member"` form — updates
  `users`/`user_roles`/`custom_field_values` and inserts a `member_action_log` row
  (`action: "member_edited"`) — per contracts.md §Member edit. Depends on T006 (Foundational).
- [X] T015 [US1] Wire T014 into
  `apps/api/src/super-admin-tenant-console/super-admin-tenant-console-routes.ts`: register
  `PATCH /tenants/:id/members/:memberId` behind `requireSuperAdminSession`, mapping
  `RecordNotFoundError`/`MemberNotFoundError` → `404`, validation errors → `422`. Depends on T014.
- [X] T016 [US1] Amend `apps/web/app/(platform-shell)/tenants/[tenantId]/page.tsx`'s Members tab: add
  an "Edit" button per row opening a `Modal` pre-filled with `fullName`/`roleId`/`departmentId`/
  `archived` (from the already-loaded row) plus that member's current custom field values (fetched on
  open), posting to `/platform-api/tenants/:id/members/:memberId`, refreshing the member list on
  success. Depends on T015. (Frontend — needs UI-UX-Pro-Max skill)

**Checkpoint**: User Story 1 should be fully functional and testable independently.

---

## Phase 4: User Story 2 - Create, Edit, and Delete a Tenant's Roles (Priority: P2)

**Goal**: A Super Admin can create a new role, edit an existing custom role's name/description/
permissions, or delete a custom role with no members assigned, for any tenant.

**Independent Test**: From the console's Roles view for a tenant, create a new role with a chosen set
of permissions, confirm it's assignable to a member, then edit its permission set and confirm the
change takes effect.

### Tests for User Story 2 ⚠️

- [X] T017 [P] [US2] Integration test: `POST /tenants/:id/roles` creates a role and its
  `role_permissions`, silently dropping any `platform`-category key from the submitted set — in
  `apps/api/tests/integration/super-admin-create-role.test.ts`.
- [X] T018 [P] [US2] Integration test: `PATCH /tenants/:id/roles/:roleId` edits name, description, and
  permission set of a custom role — in `apps/api/tests/integration/super-admin-edit-role.test.ts`.
- [X] T019 [P] [US2] Integration test: editing or deleting a system role (`sourceTemplateId` set) is
  rejected `403` "System roles cannot be modified." on both routes, even via direct call — in
  `apps/api/tests/integration/super-admin-role-system-protection.test.ts`.
- [X] T020 [P] [US2] Integration test: `DELETE /tenants/:id/roles/:roleId` with ≥1 member assigned
  returns `409` and deletes nothing; with zero members, succeeds `204` and writes one
  `tenant_config_action_log` row with `action: "role_deleted"` — in
  `apps/api/tests/integration/super-admin-delete-role.test.ts`.
- [X] T021 [P] [US2] Integration test: the single platform-wide Super Admin role
  (`tenant_id IS NULL`) is never reachable (as not-found) through any of the three role routes, for
  any `:id` — in `apps/api/tests/integration/super-admin-role-platform-role-unreachable.test.ts`.
- [X] T022 [P] [US2] Integration test: `401` without a session, `403` with a tenant-user session, on
  all three role routes — in `apps/api/tests/integration/super-admin-role-forbidden.test.ts`.

### Implementation for User Story 2

- [X] T023 [US2] Implement `apps/api/src/super-admin-tenant-console/manage-tenant-roles.ts`:
  `createTenantRole`, `editTenantRole`, `deleteTenantRole` — tenant-scoped role lookup
  (`and(eq(roles.id, roleId), eq(roles.tenantId, tenantId))`), system-role guard (throws
  `SystemRoleError`), a tenant-scoped permission-catalog query excluding `category = 'platform'`
  (research.md §4), member-count-based delete guard (throws `RoleInUseError`), and a
  `logTenantConfigAction` call (`entity_type: "role"`) via T007 on every write. Depends on T006, T007
  (Foundational).
- [X] T024 [US2] Wire T023 into `super-admin-tenant-console-routes.ts`: register
  `POST`/`PATCH`/`DELETE /tenants/:id/roles(/:roleId)` behind `requireSuperAdminSession`, mapping
  `RecordNotFoundError` → `404`, `SystemRoleError` → `403`, `RoleNameConflictError` → `409`,
  `RoleInUseError` → `409`. Depends on T023.
- [X] T025 [US2] Amend the console page's Roles tab: add "New Role" and, per non-system row, "Edit"/
  "Delete" actions (hidden when `isSystem: true`, mirroring `settings/roles/page.tsx`'s own
  treatment), a `Modal` with name/description fields and a permission-key checkbox list grouped the
  same way the tenant-side Roles & Permissions screen groups them, posting to the new routes.
  Depends on T024. (Frontend — needs UI-UX-Pro-Max skill)

**Checkpoint**: User Stories 1 and 2 should both work independently.

---

## Phase 5: User Story 3 - Create and Edit a Tenant's Departments (Priority: P3)

**Goal**: A Super Admin can create a new department or edit an existing one's name, description,
parent, status, and Manager/Assistant Manager, for any tenant.

**Independent Test**: From the console's Departments view for a tenant, create a new department,
assign it a parent, then edit its Manager, and confirm both changes are reflected immediately in that
tenant's own Department Management screen.

### Tests for User Story 3 ⚠️

- [X] T026 [P] [US3] Integration test: `POST /tenants/:id/departments` creates a department scoped to
  that tenant — in `apps/api/tests/integration/super-admin-create-department.test.ts`.
- [X] T027 [P] [US3] Integration test: `PATCH /tenants/:id/departments/:departmentId` edits name,
  description, parent, status, and Manager/Assistant Manager — in
  `apps/api/tests/integration/super-admin-edit-department.test.ts`.
- [X] T028 [P] [US3] Integration test: the 3-level hierarchy cap and cycle rejection both hold, and a
  proposed parent belonging to a *different* tenant than `:id` is rejected as not found (the
  cross-tenant-leak regression research.md §1 flags for the tenant-scoped `findAncestorChain`
  equivalent) — in `apps/api/tests/integration/super-admin-department-hierarchy.test.ts`.
- [X] T029 [P] [US3] Integration test: a case-insensitive duplicate name within a tenant returns
  `409`; the same name at a *different* tenant succeeds — in
  `apps/api/tests/integration/super-admin-department-name-conflict.test.ts`.
- [X] T030 [P] [US3] Integration test: `401`/`403` without a Super Admin session on both routes — in
  `apps/api/tests/integration/super-admin-department-forbidden.test.ts`.

### Implementation for User Story 3

- [X] T031 [US3] Implement `apps/api/src/super-admin-tenant-console/manage-tenant-departments.ts`:
  `createTenantDepartment`, `editTenantDepartment` — a tenant-scoped `findAncestorChainForTenant`
  (research.md §1, explicit `tenant_id` filter unlike `department-hierarchy.ts`'s original), a
  tenant-scoped Manager/Assistant-Manager existence check, hierarchy/manager validation throwing
  `DepartmentValidationError` with the exact tenant-side messages (contracts.md), and a
  `logTenantConfigAction` call (`entity_type: "department"`) via T007 on every write. Depends on
  T006, T007 (Foundational).
- [X] T032 [US3] Wire T031 into `super-admin-tenant-console-routes.ts`: register
  `POST`/`PATCH /tenants/:id/departments(/:departmentId)`, mapping `RecordNotFoundError` → `404`,
  `DepartmentValidationError` → `422`, `DepartmentNameConflictError` → `409`. Depends on T031.
- [X] T033 [US3] Amend the console page's Departments tab: add "New Department" and per-row "Edit"
  actions, a `Modal` with name/description/parent/status/Manager/Assistant-Manager fields (parent and
  manager pickers populated from this tab's and the Members tab's already-fetched data), posting to
  the new routes. Depends on T032. (Frontend — needs UI-UX-Pro-Max skill)

**Checkpoint**: User Stories 1, 2, and 3 should all work independently.

---

## Phase 6: User Story 4 - Create, Edit, and Archive a Tenant's Custom Field Definitions (Priority: P4)

**Goal**: A Super Admin can add a new custom field to one of a tenant's registered form types, edit an
existing tenant-owned field, or archive one that already has stored values.

**Independent Test**: From the console's Forms view for a tenant, add a new custom field to the
Member form, confirm it renders on that tenant's own member form, then archive it and confirm it
disappears from new submissions while previously stored values are preserved.

### Tests for User Story 4 ⚠️

- [X] T034 [P] [US4] Integration test: `POST /tenants/:id/custom-fields` creates a field with
  `tenant_id: :id` (never `NULL`) and `created_by: "super_admin"` — in
  `apps/api/tests/integration/super-admin-create-custom-field.test.ts`.
- [X] T035 [P] [US4] Integration test: `PATCH /tenants/:id/custom-fields/:fieldId` edits label/
  fieldType/options/isRequired, and `archived: true` archives the field without deleting any
  previously stored `custom_field_values` row — in
  `apps/api/tests/integration/super-admin-edit-custom-field.test.ts`.
- [X] T036 [P] [US4] Integration test: a field-key collision, against either a global field or this
  tenant's own existing field for the same form type, returns `409` — in
  `apps/api/tests/integration/super-admin-custom-field-key-conflict.test.ts`.
- [X] T037 [P] [US4] **Mandatory regression** (plan.md Technical Context > Testing): a global field
  (`tenant_id IS NULL`) is unreachable — `404` — through `PATCH /tenants/:id/custom-fields/:fieldId`
  for any `:id`, proving this route's own `tenant_id = :id` filter (not RLS, which alone would permit
  it — research.md §2) is what blocks it — in
  `apps/api/tests/integration/super-admin-custom-field-global-unreachable.test.ts`.
- [X] T038 [P] [US4] Integration test: `401`/`403` without a Super Admin session on both routes — in
  `apps/api/tests/integration/super-admin-custom-field-forbidden.test.ts`.

### Implementation for User Story 4

- [X] T039 [US4] Implement `apps/api/src/super-admin-tenant-console/manage-tenant-custom-fields.ts`:
  `createTenantCustomField`, `editTenantCustomField` — tenant-scoped `getFormFieldsForTenant`/
  `fieldKeyCollisionExistsForTenant` equivalents (research.md §1), every query filtered explicitly by
  `tenant_id = :id` (research.md §2 — the load-bearing global-field exclusion, not a belt-and-suspenders
  extra), `created_by: "super_admin"` on create, and a `logTenantConfigAction` call
  (`entity_type: "custom_field"`, action `"custom_field_created"`/`"custom_field_edited"`/
  `"custom_field_archived"`) via T007 on every write. Depends on T006, T007 (Foundational).
- [X] T040 [US4] Wire T039 into `super-admin-tenant-console-routes.ts`: register
  `POST`/`PATCH /tenants/:id/custom-fields(/:fieldId)`, mapping `RecordNotFoundError` → `404`,
  `FieldKeyConflictError` → `409`. Depends on T039.
- [X] T041 [US4] Add a new "Forms" tab to the console page: a form-type selector, its field list, and
  "New Field"/"Edit"/"Archive" actions, a `Modal` with label/fieldType/options/isRequired fields —
  modeled on `apps/web/app/(dashboard-shell)/settings/forms/forms-settings-client.tsx`'s field
  list/add-edit form, but using this console page's existing Modal pattern (no drag-reorder,
  research.md §5). Depends on T040. (Frontend — needs UI-UX-Pro-Max skill)

**Checkpoint**: All four user stories should now be independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T042 [P] Integration test: two concurrent edits to the same role's permission set (or the same
  department) leave a consistent last-write-wins result, no partial/corrupted state (spec Edge
  Cases) — in `apps/api/tests/integration/super-admin-edit-tenant-config-concurrent.test.ts`.
- [ ] T043 Run `quickstart.md`'s nine scenarios end-to-end against a local dev stack, including the
  browser-based checks (Forms tab rendering/disappearing a field live on that tenant's own member
  form). Depends on all prior tasks.
- [ ] T044 Manually verify all six Success Criteria (SC-001–SC-006) in a real browser session per this
  repo's UI verification convention (start the dev server, exercise the golden path and edge cases,
  don't just rely on passing tests). Depends on T043.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all four user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational completion. No dependency on US2–US4.
- **User Story 2 (Phase 4)**: Depends on Foundational completion. No dependency on US1/US3/US4.
- **User Story 3 (Phase 5)**: Depends on Foundational completion. No dependency on US1/US2/US4.
- **User Story 4 (Phase 6)**: Depends on Foundational completion. No dependency on US1/US2/US3.
- **Polish (Phase 7)**: Depends on all four user stories being complete.

### Within Each User Story

- All test tasks for a story can be written and run in parallel — different files, all failing
  against the not-yet-implemented route until that story's implementation tasks land.
- Within each story: handler implementation → route wiring → frontend, a strict sequence (the
  frontend task calls the route the wiring task registers).

### Parallel Opportunities

- T001/T002 (Setup) in parallel.
- T006/T007 (Foundational) can run in parallel with each other once T003–T005 land; T003→T004→T005 is
  a strict migration sequence.
- All six User Story 1 tests (T008–T013) in parallel.
- All six User Story 2 tests (T017–T022) in parallel.
- All five User Story 3 tests (T026–T030) in parallel.
- All five User Story 4 tests (T034–T038) in parallel.
- Once Foundational is done, **all four user stories can proceed in parallel** (different handler
  files, different frontend tab sections) — this feature's stories are more independent of one
  another than most, since each targets a different database table.

---

## Parallel Example: User Story 1

```bash
# Launch all User Story 1 tests together:
Task: "Success-path test in apps/api/tests/integration/super-admin-edit-member.test.ts"
Task: "Cross-tenant validation test in apps/api/tests/integration/super-admin-edit-member-validation.test.ts"
Task: "Archive/department-leader test in apps/api/tests/integration/super-admin-edit-member-archive.test.ts"
Task: "Custom field values test in apps/api/tests/integration/super-admin-edit-member-custom-fields.test.ts"
Task: "Action log test in apps/api/tests/integration/super-admin-edit-member-action-log.test.ts"
Task: "Forbidden/not-found test in apps/api/tests/integration/super-admin-edit-member-forbidden.test.ts"
```

## Parallel Example: Across Stories (Post-Foundational)

```bash
# With four developers, once Phase 2 (Foundational) is done:
Developer A: Phase 3 (User Story 1 — member edit)
Developer B: Phase 4 (User Story 2 — roles)
Developer C: Phase 5 (User Story 3 — departments)
Developer D: Phase 6 (User Story 4 — custom fields)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational.
3. Complete Phase 3: User Story 1 — reverses Spec 020's FR-014 for members, the capability most
   directly requested.
4. **STOP and VALIDATE**: Run quickstart.md Scenarios 1–2, 8–9.
5. Deploy/demo if ready.

### Incremental Delivery

1. Complete Setup + Foundational → foundation ready (includes the new audit-log table US2–US4 need).
2. Add User Story 1 → test independently → deploy/demo (MVP!).
3. Add User Story 2 (roles) → test independently → deploy/demo.
4. Add User Story 3 (departments) → test independently → deploy/demo.
5. Add User Story 4 (custom fields) → test independently → deploy/demo.
6. Complete Phase 7: Polish (concurrency test + full quickstart pass + manual SC verification).
7. Each story adds value without breaking any previous story — they touch disjoint tables.

### Parallel Team Strategy

With up to four developers once Foundational (T003–T007) is done: one developer per user story
(US1–US4), each working a disjoint set of files (different handler file, different DB table, different
tab section of the same frontend page — coordinate on that one shared file, `page.tsx`, to avoid merge
conflicts across stories).

---

## Notes

- `[P]` tasks = different files, no dependency on an incomplete task.
- `[Story]` label maps task to specific user story for traceability; Setup/Foundational/Polish tasks
  carry no story label.
- Every test task must be written and fail before its matching implementation task.
- Every new handler MUST filter every query by the route's own `:id` param explicitly — never rely on
  `request.superAdminDb`'s ambient RLS context (research.md §1, plan.md Summary). For the
  custom-fields surface specifically, this filter is the *entire* mechanism keeping a global field
  out of reach, not defense-in-depth (research.md §2, plan.md Technical Context > Constraints) — T037
  exists specifically to prove this.
- Commit after each task or logical group.
