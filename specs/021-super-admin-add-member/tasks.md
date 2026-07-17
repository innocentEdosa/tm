---

description: "Task list for implementing the Super Admin Add Member feature"
---

# Tasks: Super Admin Add Member

**Input**: Design documents from `/specs/021-super-admin-add-member/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md,
data-model.md, contracts/ (`super-admin-add-member-api.md`), quickstart.md

**Tests**: Included — matching this repo's established precedent for anything touching Super Admin
cross-tenant access (Spec 020). This feature's core risk is the two new, explicitly-tenant-filtered
role/department existence checks (research.md §1) — a regression there would silently let a role or
department from the *wrong* tenant validate, which is exactly the class of bug that must be proven
against a real Postgres connection, not assumed from reading the code. Test tasks are not optional in
this feature.

**Dependency sign-off status**: None needed — this feature adds no new package (research.md, plan.md
Technical Context). No task in this list should run `pnpm add`.

**A note on scope**: This feature is small enough (one new route, no new schema/migration) that it
maps to a single user story rather than several — every task below belongs to User Story 1.

## Format: `[ID] [P?] [Story?] Description with file path (Backend-only | Frontend — needs UI-UX-Pro-Max skill)`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Maps the task to its user story (US1); Setup/Foundational/Polish tasks carry no story
  label

---

## Phase 1: Setup

- [X] T001 Confirm no new dependencies are required for this feature (research.md §2–§4) — a
  documentation/gate check, not a code change. (Backend-only)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared error types the new route's handler and route-wiring both need.

- [X] T002 Amend `apps/api/src/super-admin-tenant-console/errors.ts`: add `RoleNotFoundError`,
  `DepartmentNotActiveError`, and `EmailConflictError` (data-model.md, contracts/
  `super-admin-add-member-api.md`). (Backend-only)

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Add a Member to a Tenant Without Leaving the Console (Priority: P1) 🎯 MVP

**Goal**: A Super Admin can add a new member to any tenant from that tenant's console Members tab,
reusing the exact validation order, OTP/invite flow, and email content already used by the
tenant-side `POST /tenant-auth/team` (Specs 012/013).

**Independent Test**: From the console's Members tab, select "Add Member," fill in a new person's
name, email, and an existing role, submit, and confirm the member appears in the directory
immediately and receives the branded invite email.

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T003 [P] [US1] Integration test: `POST /tenants/:id/members` with valid input returns `201`,
  creates a `users` row with `must_change_password: true` and `invited_by: NULL`, creates the
  matching `user_roles` row, and sends exactly one invite email (via a swapped-in
  `RecordingMailSender`, matching Spec 020's own mail-assertion pattern) in
  `apps/api/tests/integration/super-admin-add-member.test.ts`.
- [X] T004 [P] [US1] Integration test: `400` when `fullName`/`email`/`roleId` is missing; `404` when
  `:id` does not resolve to any tenant, in
  `apps/api/tests/integration/super-admin-add-member-validation.test.ts`.
- [X] T005 [P] [US1] Integration test: a second request with the same email at the same tenant
  returns `409` and creates no second row; the same email at a *different* tenant succeeds, in
  `apps/api/tests/integration/super-admin-add-member-duplicate-email.test.ts`.
- [X] T006 [P] [US1] Integration test: a nonexistent `roleId` returns `422 "Role not found"`, and a
  `roleId` that belongs to a *different* tenant than `:id` is equally rejected as not found (the
  cross-tenant-leak regression research.md §1 flags) in
  `apps/api/tests/integration/super-admin-add-member-role-validation.test.ts`.
- [X] T007 [P] [US1] Integration test: an archived department returns
  `422 "Department not found or not active"`, and a `departmentId` belonging to a *different* tenant
  than `:id` is equally rejected, in
  `apps/api/tests/integration/super-admin-add-member-department-validation.test.ts`.
- [X] T008 [P] [US1] Integration test: `401` with no session and with a tenant-user session instead
  of a Super Admin one (spec FR-009) in
  `apps/api/tests/integration/super-admin-add-member-forbidden.test.ts`.
- [X] T009 [P] [US1] Integration test: adding a member succeeds identically after the tenant has been
  archived (`POST /tenants/:id/archive`, Spec 015) — spec FR-010 — in
  `apps/api/tests/integration/super-admin-add-member-archived-tenant.test.ts`.
- [X] T010 [P] [US1] Integration test: a successful add-member call writes exactly one
  `member_action_log` row with the correct `tenant_id`/`member_id`/`super_admin_id`/
  `action: "member_added"` in `apps/api/tests/integration/super-admin-add-member-action-log.test.ts`.

### Implementation for User Story 1

- [X] T011 [US1] Implement `apps/api/src/super-admin-tenant-console/add-tenant-member.ts`:
  `addTenantMember(db, params)` — local `roleExistsForTenant`/`departmentIsActiveForTenant` helpers
  (explicit `tenant_id` filter, research.md §1), validation order matching
  contracts/super-admin-add-member-api.md exactly, `generateOneTimePassword` + `hashPassword` +
  `users`/`user_roles` inserts, `sendMemberInviteEmail` call, `member_action_log` insert with
  `action: "member_added"`. Depends on Foundational (T002).
- [X] T012 [US1] Wire T011 into
  `apps/api/src/super-admin-tenant-console/super-admin-tenant-console-routes.ts`: register
  `POST /tenants/:id/members` behind `requireSuperAdminSession`, mapping `TenantNotFoundError` → `404`,
  `RoleNotFoundError`/`DepartmentNotActiveError` → `422`, `EmailConflictError` → `409`. Depends on
  T011.
- [X] T013 [US1] Amend
  `apps/web/app/(platform-shell)/tenants/[tenantId]/page.tsx`'s Members tab: add an "Add Member"
  button opening a `Modal` form (full name, email, role — from the already-fetched Roles tab data,
  department — from the already-fetched Departments tab data, optional), posting to
  `/platform-api/tenants/:id/members`, refreshing the member list on success, and surfacing `400`/
  `409`/`422` error messages inline. Depends on T012. (Frontend — needs UI-UX-Pro-Max skill)

**Checkpoint**: User Story 1 — the entire feature — should be fully functional and testable
independently.

---

## Phase 4: Polish & Cross-Cutting Concerns

- [X] T014 [P] Integration test: two concurrent add-member requests with the same email for the same
  tenant leave exactly one member created, the other rejected with `409` (spec Edge Cases) in
  `apps/api/tests/integration/super-admin-add-member-concurrent-duplicate.test.ts`.
- [X] T015 Run `quickstart.md`'s six scenarios end-to-end against a local dev stack (one tenant, one
  role, one archived-tenant pass), including the browser-based check in Scenario 4 (the added
  member shows no "Invited By" name in that tenant's own Team Directory). Depends on all prior tasks.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS User Story 1.
- **User Story 1 (Phase 3)**: Depends on Foundational completion.
- **Polish (Phase 4)**: Depends on User Story 1 being complete.

### Within User Story 1

- All eight test tasks (T003–T010) can be written and run in parallel — different files, and all
  fail against the not-yet-implemented route (or the existing 404 for an unregistered route) until
  T011/T012 land.
- T011 → T012 → T013 is a strict sequence (handler, then route wiring, then the frontend that calls
  the wired route).

### Parallel Opportunities

- All eight User Story 1 test tasks (T003–T010) in parallel.
- T014 (Polish test) can be written in parallel with the User Story 1 test tasks, though it should
  only be *run* meaningfully once T011/T012 exist.

---

## Parallel Example: User Story 1

```bash
# Launch all User Story 1 tests together:
Task: "Success-path test in apps/api/tests/integration/super-admin-add-member.test.ts"
Task: "Validation (400/404) test in apps/api/tests/integration/super-admin-add-member-validation.test.ts"
Task: "Duplicate-email test in apps/api/tests/integration/super-admin-add-member-duplicate-email.test.ts"
Task: "Role-validation test in apps/api/tests/integration/super-admin-add-member-role-validation.test.ts"
Task: "Department-validation test in apps/api/tests/integration/super-admin-add-member-department-validation.test.ts"
Task: "Forbidden test in apps/api/tests/integration/super-admin-add-member-forbidden.test.ts"
Task: "Archived-tenant test in apps/api/tests/integration/super-admin-add-member-archived-tenant.test.ts"
Task: "Action-log test in apps/api/tests/integration/super-admin-add-member-action-log.test.ts"
```

---

## Implementation Strategy

### MVP First (and Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational.
3. Complete Phase 3: User Story 1 — this is the entire feature.
4. **STOP and VALIDATE**: Run quickstart.md's six scenarios.
5. Complete Phase 4: Polish (concurrency test + full quickstart pass).
6. Deploy/demo.

### Parallel Team Strategy

With two developers once Foundational (T002) is done:

1. Developer A: writes all eight User Story 1 tests (T003–T010) in parallel.
2. Developer B: implements T011 → T012 → T013 in sequence, running Developer A's tests against each
   handler/route change as it lands.

---

## Notes

- `[P]` tasks = different files, no dependency on an incomplete task.
- `[Story]` label maps task to specific user story for traceability; Setup/Foundational/Polish tasks
  carry no story label.
- Every test task must be written and fail before its matching implementation task.
- The new handler MUST filter every query by the route's own `:id` param explicitly — never rely on
  `request.superAdminDb`'s ambient RLS context, which is deliberately tenant-agnostic (research.md
  §1, plan.md Summary). This is the one discipline every implementation task in this file must not
  skip.
- Commit after each task or logical group.
