---

description: "Task list for implementing the Super Admin Tenant Console feature"
---

# Tasks: Super Admin Tenant Console

**Input**: Design documents from `/specs/020-super-admin-tenant-console/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md,
data-model.md, contracts/ (`super-admin-tenant-console-api.md`), quickstart.md

**Tests**: Included — matching Tenant Management (015)'s precedent. This feature's core risk is the
same class as that one: five new additive `super_admin_full_access` RLS policies (data-model.md) that
must be proven, against a real Postgres connection, to (a) actually grant `request.superAdminDb`
cross-tenant read/write access and (b) leave every tenant-scoped connection's existing
`tenant_isolation` policy completely unaffected. The password-reset action's session-invalidation and
"not forced to change" behavior (spec Clarifications) are similarly only meaningful to verify against
a real login flow, not a mock. Test tasks are not optional in this feature.

**Dependency sign-off status**: None needed — this feature adds no new package (research.md, plan.md
Technical Context). No task in this list should run `pnpm add`.

**A note on story coupling**: Both user stories operate on the same tenant/member rows and share the
Foundational phase's RLS policies and route-module scaffold, but each is independently testable:
User Story 1 needs only a tenant with existing departments/roles/members (seeded via existing specs'
routes, not this feature's own); User Story 2 additionally needs one member with an active session,
seeded directly via that member's own login route, not by depending on any User-Story-1 code path.

## Format: `[ID] [P?] [Story?] Description with file path (Backend-only | Frontend — needs UI-UX-Pro-Max skill)`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Maps the task to its user story (US1, US2); Setup/Foundational/Polish tasks carry no
  story label

---

## Phase 1: Setup

- [X] T001 Confirm no new dependencies are required for this feature (research.md §4–§5) and that
  `apps/api/drizzle.config.ts`'s existing schema glob picks up the new `member-action-log.ts` schema
  file with no config change — a documentation/gate check, not a code change. (Backend-only)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: New table → migration → the five new RLS policies that let `request.superAdminDb` read
(and, for `users`, write) across tenants (data-model.md) → the two small reusable helpers every story
depends on. **Nothing in Phase 3+ can start until this phase is complete.**

- [X] T002 [P] Create `apps/api/src/db/schema/member-action-log.ts`: `member_action_log` table (`id`
  uuid PK, `tenant_id` FK → `tenants.id` `ON DELETE SET NULL`, `member_id` FK → `users.id`
  `ON DELETE SET NULL`, `super_admin_id` FK → `super_admins.id` `ON DELETE SET NULL`, `action` text not
  null, `created_at`) per data-model.md `member_action_log`. (Backend-only)
- [X] T003 Generate the Drizzle migration from T002 via `drizzle-kit generate` (expected
  `apps/api/drizzle/0057_*.sql`, the new `member_action_log` table). Depends on T002. (Backend-only)
- [X] T004 [P] Author `apps/api/drizzle/0058_lock_member_action_log_grants.sql`: `GRANT SELECT, INSERT`
  on `member_action_log` to `tm_app`; no `UPDATE`/`DELETE` grant (append-only, data-model.md
  `member_action_log` Grants). Depends on T003. (Backend-only)
- [X] T005 [P] Author `apps/api/drizzle/0059_super_admin_full_access_departments.sql`: additive
  permissive RLS policy on `departments` — `USING (current_setting('app.is_super_admin', true) =
  'true') WITH CHECK (same)`, mirroring `tenants.super_admin_full_access` (0054) exactly.
  `tenant_isolation` (0010) is left completely unedited (data-model.md, research.md §3). Depends on
  T003 (migration-numbering sequencing). (Backend-only)
- [X] T006 [P] Author `apps/api/drizzle/0060_super_admin_full_access_roles.sql`: same policy shape as
  T005, on `roles` (`tenant_isolation` 0002 left unedited). Depends on T003. (Backend-only)
- [X] T007 [P] Author `apps/api/drizzle/0061_super_admin_full_access_role_permissions.sql`: same
  policy shape, on `role_permissions` (`tenant_isolation` 0003 left unedited). Depends on T003.
  (Backend-only)
- [X] T008 [P] Author `apps/api/drizzle/0062_super_admin_full_access_user_roles.sql`: same policy
  shape, on `user_roles` (`tenant_isolation` 0004 left unedited). Depends on T003. (Backend-only)
- [X] T009 [P] Author `apps/api/drizzle/0063_super_admin_full_access_users.sql`: same policy shape,
  on `users` (`tenant_isolation` 0011 left unedited) — this is the one table this feature also writes
  to (`password_hash`), scoped by an explicit `tenant_id`/`id` predicate in application code, never by
  ambient RLS scoping (research.md §1). Depends on T003. (Backend-only)
- [X] T010 [P] Add `revokeUserSessions(db, { tenantId, memberId })` to the existing
  `apps/api/src/tenant-management/revoke-tenant-sessions.ts`, alongside the existing
  `revokeTenantSessions` — same shape, scoped additionally by `userId` (research.md §5). (Backend-only)
- [X] T011 [P] Create `apps/api/src/super-admin-tenant-console/generate-password.ts`:
  `generateResetPassword()` — `randomBytes(9).toString("base64url")` (research.md §4). (Backend-only)
- [X] T012 Create `apps/api/src/super-admin-tenant-console/` module and
  `apps/api/src/super-admin-tenant-console/super-admin-tenant-console-routes.ts`: register all five
  routes (`GET /tenants/:id`, `GET /tenants/:id/departments`, `GET /tenants/:id/roles`,
  `GET /tenants/:id/members`, `POST /tenants/:id/members/:memberId/reset-password`) behind
  `requireSuperAdminSession` as stub `501` handlers, and register the plugin in `server.ts` alongside
  `tenantManagementRoutes`. Later story phases fill in each handler. Depends on T003. (Backend-only)

**Checkpoint**: Foundation ready — table, migrations, all five RLS policies, both helpers, route
scaffold. User story implementation can now begin.

---

## Phase 3: User Story 1 - See a Tenant's Full Picture Without Leaving the Platform Console (Priority: P1) 🎯 MVP

**Goal**: A Super Admin opens "Manage" on any tenant from the Tenants list and sees that tenant's
company details, department hierarchy, role/permission catalog, and member directory, read-only,
without ever leaving their own Super Admin session.

**Independent Test**: Log in as Super Admin, select "Manage" on a tenant row, confirm all four
sections render that tenant's own data and the URL/session never changes to the tenant's subdomain.

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T013 [P] [US1] Integration test: with two tenants each having their own departments/roles/
  members, `GET /tenants/:id`, `/departments`, `/roles`, `/members` for tenant A never return any of
  tenant B's rows (the RLS-policy gap this feature closes — research.md §1, §3) in
  `apps/api/tests/integration/super-admin-console-cross-tenant-isolation.test.ts`.
- [X] T014 [P] [US1] Integration test: all five console routes (four GETs + the reset-password POST,
  even while still a stub) return `401` with no session and with a tenant-user session cookie instead
  of a Super Admin one (spec FR-007) in
  `apps/api/tests/integration/super-admin-console-forbidden.test.ts`.
- [X] T015 [P] [US1] Integration test: `GET /tenants/:id` returns the company-detail shape
  (contracts/super-admin-tenant-console-api.md) and `404` for a nonexistent tenant id in
  `apps/api/tests/integration/super-admin-console-detail.test.ts`.
- [X] T016 [P] [US1] Integration test: `GET /tenants/:id/departments` returns the documented row shape
  including `manager`/`assistantManager`/`memberCount`/`hasChildren`, and returns `data: []` (not an
  error) for a tenant with zero departments (spec Edge Cases) in
  `apps/api/tests/integration/super-admin-console-departments.test.ts`.
- [X] T017 [P] [US1] Integration test: `GET /tenants/:id/roles` returns `permissionKeys`/`isSystem`/
  `memberCount` correctly (verifying the reused `getRoleMemberCounts` intersects correctly against
  this tenant's own role ids only — research.md §2), and `data: []` for a tenant with zero custom
  roles, in `apps/api/tests/integration/super-admin-console-roles.test.ts`.
- [X] T018 [P] [US1] Integration test: `GET /tenants/:id/members` returns the documented row shape,
  honors `search`/`page`/`pageSize`, and returns `data: []` for a tenant with zero members, in
  `apps/api/tests/integration/super-admin-console-members.test.ts`.
- [X] T019 [P] [US1] Integration test: after archiving a tenant (Tenant Management 015's
  `POST /tenants/:id/archive`), all four GET routes still return `200` with unchanged data (spec
  FR-013, Clarifications) in `apps/api/tests/integration/super-admin-console-archived-tenant.test.ts`.

### Implementation for User Story 1

- [X] T020 [P] [US1] Implement `apps/api/src/super-admin-tenant-console/get-tenant-detail.ts`:
  `GET /tenants/:id` handler body — reuses the tenant-detail field set from Tenant Management's list
  row (data-model.md Read-model shapes), `404 TenantNotFoundError` if `:id` doesn't resolve. Depends
  on Foundational (T003, T012).
- [X] T021 [P] [US1] Implement `apps/api/src/super-admin-tenant-console/get-tenant-departments.ts`:
  `GET /tenants/:id/departments` handler body — own tenant-filtered query (`WHERE tenant_id = :id`,
  never reusing `department-hierarchy.ts`'s helpers — research.md §1), same response shape as
  `GET /tenant/departments` (contracts/super-admin-tenant-console-api.md). Depends on Foundational
  (T003, T012).
- [X] T022 [P] [US1] Implement `apps/api/src/super-admin-tenant-console/get-tenant-roles.ts`:
  `GET /tenants/:id/roles` handler body — own tenant-filtered `roles`/`role_permissions` query, reuses
  `getRoleMemberCounts(request.superAdminDb!)` from `permissions/role-member-counts.ts` unmodified,
  intersected against this tenant's own role ids only (research.md §2). Depends on Foundational (T003,
  T012).
- [X] T023 [P] [US1] Implement `apps/api/src/super-admin-tenant-console/get-tenant-members.ts`:
  `GET /tenants/:id/members` handler body — own tenant-filtered `users`/`user_roles`/`roles`/
  `departments` query with `search`/`page`/`pageSize`, no visibility-scope narrowing (a Super Admin
  always sees every member). Depends on Foundational (T003, T012).
- [X] T024 [US1] Wire the four handlers (T020–T023) into
  `apps/api/src/super-admin-tenant-console/super-admin-tenant-console-routes.ts`, replacing their
  `501` stubs. Depends on T020, T021, T022, T023.
- [X] T025 [US1] Create `apps/web/app/(platform-shell)/tenants/[tenantId]/page.tsx`: the console page
  — Company/Departments/Roles/Members sections inside the platform dashboard shell, fetching all four
  routes via `/platform-api/tenants/:id...` (never a direct `API_ORIGIN` fetch — research.md §8), no
  edit affordance anywhere in Departments/Roles/Members (spec FR-014). Depends on T024.
  (Frontend — needs UI-UX-Pro-Max skill)
- [X] T026 [P] [US1] Amend `apps/web/app/(platform-shell)/tenants/page.tsx`: add a "Manage" row action
  (alongside the existing Edit/Archive/Downgrade/Delete menu items) linking to `/tenants/:id`. Depends
  on T025 existing as a link target. (Frontend — needs UI-UX-Pro-Max skill)

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently.

---

## Phase 4: User Story 2 - Unblock a Locked-Out Member Without Email (Priority: P1)

**Goal**: From the console's Members section, a Super Admin can reset a member's password directly —
no email, no forced change — with the member's existing sessions invalidated immediately and the
action recorded.

**Independent Test**: From the console's member directory, trigger the reset action on a member with
an active session; confirm the password changes with no email sent, that prior session stops working,
and that the member can log in immediately with the new password with no forced-change prompt.

### Tests for User Story 2 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T027 [P] [US2] Integration test: `POST /tenants/:id/members/:memberId/reset-password` returns
  `200` with a non-empty `generatedPassword`, updates `users.password_hash` to match it (verified via
  `verifyPassword`), and sends no email (assert against the mail sink used by `apps/api/src/mail`) in
  `apps/api/tests/integration/super-admin-console-reset-password.test.ts`.
- [X] T028 [P] [US2] Integration test: an active `user_sessions` row for that member is `revoked_at`-
  stamped by the same reset call, and a subsequent request using that session's token is rejected, in
  `apps/api/tests/integration/super-admin-console-reset-password-session-revoke.test.ts`.
- [X] T029 [P] [US2] Integration test: after a reset, the member can log in directly with the
  generated password with no forced-change redirect, and `users.must_change_password` remains `false`
  (spec Clarifications) in
  `apps/api/tests/integration/super-admin-console-reset-password-no-forced-change.test.ts`.
- [X] T030 [P] [US2] Integration test: a reset writes exactly one `member_action_log` row with the
  correct `tenant_id`/`member_id`/`super_admin_id`/`action: "password_reset"` in
  `apps/api/tests/integration/super-admin-console-member-action-log.test.ts`.
- [X] T031 [P] [US2] Integration test: after archiving/suspending a tenant, a reset for one of its
  members still succeeds identically (spec FR-013) in
  `apps/api/tests/integration/super-admin-console-archived-tenant-reset.test.ts`.
- [X] T032 [P] [US2] Integration test: a reset request with a `:memberId` that doesn't belong to
  `:id`'s tenant (wrong tenant, or nonexistent) returns `404`, never silently resetting another
  tenant's member, in
  `apps/api/tests/integration/super-admin-console-reset-password-wrong-tenant.test.ts`.

### Implementation for User Story 2

- [X] T033 [US2] Implement `apps/api/src/super-admin-tenant-console/reset-member-password.ts`: resolve
  `:memberId` scoped to `tenant_id = :id` (404 if absent), generate + hash a new password
  (`generateResetPassword` + `hashPassword`), update `users.password_hash` only (leave
  `must_change_password`/`otp_expires_at` untouched), call `revokeUserSessions`, insert one
  `member_action_log` row — all in one transaction — and return
  `{ generatedPassword }` (contracts/super-admin-tenant-console-api.md). Depends on Foundational
  (T009, T010, T011, T012).
- [X] T034 [US2] Wire T033 into
  `apps/api/src/super-admin-tenant-console/super-admin-tenant-console-routes.ts`, replacing the
  `POST /tenants/:id/members/:memberId/reset-password` stub. Depends on T033.
- [X] T035 [US2] Amend `apps/web/app/(platform-shell)/tenants/[tenantId]/page.tsx`'s Members section:
  add a "Reset Password" row action with a confirmation step, then a result modal showing the
  generated password once with a copy affordance and a "won't be shown again" notice — no forced-
  change messaging (spec Clarifications). Depends on T034, T025. (Frontend — needs UI-UX-Pro-Max
  skill)

**Checkpoint**: Both User Story 1 and User Story 2 should now work independently and together.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [X] T036 [P] Integration test: two concurrent reset-password requests for the same member leave the
  member in a single, consistent final password state (no lost-update race — spec Edge Cases) in
  `apps/api/tests/integration/super-admin-console-reset-password-concurrent.test.ts`.
- [X] T037 [P] Integration test: all five console routes return a clear `404` (not a raw error) for a
  tenant id that does not exist, e.g. a purged tenant (spec Edge Cases) in
  `apps/api/tests/integration/super-admin-console-tenant-not-found.test.ts`.
- [X] T038 Run `quickstart.md`'s five scenarios end-to-end against a local dev stack (two real
  tenants, one archived) and confirm every expected result, including the browser-based checks in
  Scenarios 1 and 5 (no edit affordance leaks into the console; the browser URL/session never becomes
  the tenant's own subdomain). Depends on all prior tasks.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS both user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational completion. No dependency on User Story 2.
- **User Story 2 (Phase 4)**: Depends on Foundational completion. Its route/handler work (T033, T034)
  has no code dependency on User Story 1; its frontend task (T035) amends the page User Story 1
  creates (T025), so T035 must follow T025.
- **Polish (Phase 5)**: Depends on both user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) — no dependency on User Story 2.
- **User Story 2 (P1)**: Can start its backend tasks (T033, T034) after Foundational (Phase 2) in
  parallel with User Story 1's backend tasks; its one frontend task (T035) needs User Story 1's page
  (T025) to exist first.

### Parallel Opportunities

- All Foundational tasks marked `[P]` (T002, T004–T011) can run in parallel once T003 (the generated
  migration) exists.
- All six User Story 1 test tasks (T013–T019... note T019 too) can run in parallel — different files.
- User Story 1's four read-handler implementations (T020–T023) can run in parallel — different files,
  no shared state.
- All six User Story 2 test tasks (T027–T032) can run in parallel — different files.
- User Story 1's backend work (T020–T024) and User Story 2's backend work (T033–T034) can proceed in
  parallel by different developers once Foundational is done — they touch disjoint files.

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Cross-tenant isolation test in apps/api/tests/integration/super-admin-console-cross-tenant-isolation.test.ts"
Task: "Forbidden/401 test in apps/api/tests/integration/super-admin-console-forbidden.test.ts"
Task: "Tenant detail shape test in apps/api/tests/integration/super-admin-console-detail.test.ts"
Task: "Departments shape/empty-state test in apps/api/tests/integration/super-admin-console-departments.test.ts"
Task: "Roles shape/empty-state test in apps/api/tests/integration/super-admin-console-roles.test.ts"
Task: "Members shape/pagination test in apps/api/tests/integration/super-admin-console-members.test.ts"
Task: "Archived-tenant read test in apps/api/tests/integration/super-admin-console-archived-tenant.test.ts"

# Launch all four read-handler implementations together:
Task: "Implement get-tenant-detail.ts"
Task: "Implement get-tenant-departments.ts"
Task: "Implement get-tenant-roles.ts"
Task: "Implement get-tenant-members.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (CRITICAL — blocks both stories).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: Run quickstart.md Scenarios 1, 2, 4, 5 — a Super Admin can view any tenant's
   full detail, denied without a session, regardless of tenant status, with no edit affordance.
5. Deploy/demo if ready — the read-only console alone is already a coherent, demoable slice.

### Incremental Delivery

1. Complete Setup + Foundational → foundation ready.
2. Add User Story 1 → test independently → deploy/demo.
3. Add User Story 2 → test independently (quickstart.md Scenario 3) → deploy/demo — the full feature.

### Parallel Team Strategy

With two developers once Foundational is done:

1. Developer A: User Story 1 backend (T020–T024), then frontend (T025, T026).
2. Developer B: User Story 2 backend (T033, T034) in parallel — no dependency on Developer A's
   backend work — then waits on T025 before doing T035.

---

## Notes

- `[P]` tasks = different files, no dependency on an incomplete task.
- `[Story]` label maps task to specific user story for traceability; Setup/Foundational/Polish tasks
  carry no story label.
- Every test task must be written and fail (or 404/501 against the stub routes) before its matching
  implementation task.
- Every route handler explicitly filters by its `:id`/`:memberId` route param — never relies on
  `request.superAdminDb`'s ambient RLS context, which is deliberately tenant-agnostic (research.md
  §1, plan.md Summary). This is the one discipline every implementation task in this file must not
  skip.
- Commit after each task or logical group.
- Stop at the Phase 3 checkpoint to validate User Story 1 independently before starting Phase 4.
