---

description: "Task list for implementing the Tenant Management feature"
---

# Tasks: Tenant Management

**Input**: Design documents from `/specs/015-tenant-management/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md,
contracts/ (`tenant-management-api.md`), quickstart.md

**Tests**: Included — matching Tenant Provisioning Core's precedent (constitution Principle I requires
isolation to be proven at the data layer, and this feature's core risk — the new
`super_admin_full_access` RLS policy, research.md §8 — is exactly the kind of thing that must be proven
against a real Postgres connection, not assumed). Test tasks are not optional in this feature.

**Dependency sign-off status**: None needed — this feature adds no new package (research.md §9, plan.md
Technical Context). No task in this list should run `pnpm add`.

**A note on story coupling**: All five stories share one underlying `tenants` row and one new RLS
policy (Foundational phase), so "independently testable" here means each story's tests target that
story's own action in isolation — seeding preconditions (e.g. an already-archived tenant, for a test
that isn't itself about archiving) directly via SQL/test helpers rather than by calling another story's
route, exactly like Tenant Provisioning Core's own tasks.md precedent.

## Format: `[ID] [P?] [Story?] Description with file path (Backend-only | Frontend — needs UI-UX-Pro-Max skill)`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Maps the task to its user story (US1–US5); Setup/Foundational/Polish tasks carry no
  story label

---

## Phase 1: Setup

- [X] T001 Confirm no new dependencies are required for this feature (research.md §9) and that
  `apps/api/drizzle.config.ts`'s existing schema glob picks up this feature's new/amended schema files
  with no config change — a documentation/gate check, not a code change. (Backend-only)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema → migration → the two new RLS policies that close the "Super Admin can't see other
tenants" gap (research.md §8) → the session-block amendment every archive/delete-touching story relies
on. **Nothing in Phase 3+ can start until this phase is complete.**

- [X] T002 [P] Amend `apps/api/src/db/schema/tenants.ts`: add `archivedAt`, `deletionRequestedAt`,
  `deletionPurgeAt` (`timestamptz`, nullable) per data-model.md `tenants`. (Backend-only)
- [X] T003 [P] Create `apps/api/src/db/schema/tenant-action-log.ts`: `tenant_action_log` table (`id`
  uuid PK, `tenant_id` FK → `tenants.id`, `super_admin_id` FK → `super_admins.id`, `action` text not
  null, `created_at`) per data-model.md `tenant_action_log`. (Backend-only)
- [X] T004 Generate the Drizzle migration from T002–T003 via `drizzle-kit generate` (expected
  `apps/api/drizzle/0053_*.sql`, covering both the new `tenants` columns and the new
  `tenant_action_log` table). Depends on T002, T003. (Backend-only)
- [X] T005 [P] Author `apps/api/drizzle/0054_super_admin_full_access_tenants.sql`: additive permissive
  RLS policy on `tenants` — `USING (current_setting('app.is_super_admin', true) = 'true') WITH CHECK
  (same)`, mirroring `form_fields.super_admin_full_access` exactly. `tenant_isolation` is left
  completely unedited (data-model.md `tenants` Isolation, research.md §8). Depends on T004.
  (Backend-only)
- [X] T006 [P] Author `apps/api/drizzle/0055_super_admin_full_access_user_sessions.sql`: same policy
  shape as T005, on `user_sessions` (data-model.md `user_sessions` Isolation, research.md §8). Depends
  on T004. (Backend-only)
- [X] T007 [P] Author `apps/api/drizzle/0056_lock_tenant_action_log_grants.sql`: `GRANT INSERT, SELECT`
  on `tenant_action_log` to `tm_app`; no `UPDATE`/`DELETE` grant (append-only log, data-model.md
  `tenant_action_log` Isolation). Depends on T004. (Backend-only)
- [X] T008 Create `apps/api/src/tenant-management/` module and
  `apps/api/src/tenant-management/tenant-management-routes.ts`: register all six routes (`GET
  /tenants`, `PATCH /tenants/:id`, `POST /tenants/:id/archive`, `POST /tenants/:id/reactivate`, `POST
  /tenants/:id/downgrade`, `POST /tenants/:id/delete`, `POST /tenants/:id/recover`) behind
  `requireSuperAdminSession` as stub 501 handlers, and register the plugin in the server's route
  registration alongside `provisioningRoutes`. Later story phases fill in each handler. Depends on
  T004. (Backend-only)
- [X] T009 Amend `apps/api/src/tenant-auth/tenant-user-context.ts`: after the existing `users.archived_at`
  check, also look up the resolved tenant's `archived_at`/`deletion_requested_at` and leave
  `request.user` unset if either is non-null — same short-circuit shape as the existing per-user check
  (FR-007, FR-015, research.md §3). Depends on T004. (Backend-only)

**Checkpoint**: Foundation ready — schema, migrations, RLS gap closed, session-gate amended. User story
implementation can now begin.

---

## Phase 3: User Story 1 - See Every Tenant on the Platform at a Glance (Priority: P1) 🎯 MVP

**Goal**: A Super Admin opens "Tenants" and sees every provisioned tenant in one list, and can reach
the existing "Add Tenant" form from there.

**Independent Test**: Log in as Super Admin, `GET /tenants`, confirm every previously provisioned
tenant appears with company name, subdomain, status, primary contact, and created date (quickstart.md
Scenario 1); confirm a non-Super-Admin caller gets `401` (Scenario 2).

### Tests for User Story 1

- [X] T010 [P] [US1] Write `apps/api/tests/integration/tenant-management-list-forbidden.test.ts`:
  `GET /tenants` with no session, and with a tenant-user session, both return `401` (FR-002).
- [X] T011 [P] [US1] Write `apps/api/tests/integration/tenant-management-list.test.ts`: seed two
  tenants via `provisionTenant`, assert `GET /tenants` as a Super Admin returns both with `name`,
  `subdomain`, `status`, `isArchived: false`, `isPendingDeletion: false`, `primaryContactEmail`,
  `createdAt` (FR-001; SC-001). This test is also the regression guard for T005/research.md §8 — it
  must fail with an empty list if that RLS policy is missing or wrong.

### Implementation for User Story 1

- [X] T012 [US1] Implement `listTenants` in `apps/api/src/tenant-management/list-tenants.ts`: paginated
  query (`page`, `pageSize`, default 25) against `tenants` via `request.superAdminDb`, per
  contracts/tenant-management-api.md `GET /tenants`. Depends on T008, T005.
  (Backend-only)
- [X] T013 [US1] Wire the real `GET /tenants` handler in `tenant-management-routes.ts` to T012,
  replacing its stub. Depends on T012. (Backend-only)
- [X] T014 [P] [US1] Create `apps/web/app/(platform-shell)/tenants/page.tsx`: server component, same
  shape as `(dashboard-shell)/settings/team/page.tsx` — resolves the Super Admin session and passes
  identity through to the client component. (Frontend — needs UI-UX-Pro-Max skill)
- [X] T015 [US1] Create `apps/web/app/(platform-shell)/tenants/tenants-client.tsx`: fetches `GET
  /platform-api/tenants`, renders the list (table/cards per the locked design system) with company
  name, subdomain, status, primary contact, created date, `Pagination` (`PAGE_SIZE = 25`, matching
  `team-settings-client.tsx`), and an "Add Tenant" `Button` linking to `/provisioning/new`. Depends on
  T014, T013. (Frontend — needs UI-UX-Pro-Max skill)
- [X] T016 [US1] Amend `apps/web/app/(platform-shell)/layout.tsx`: nav entry label "Provision Tenant" →
  "Tenants", `href` `/provisioning/new` → `/tenants` (FR-003). Depends on T015. (Frontend — needs
  UI-UX-Pro-Max skill)
- [X] T017 [US1] Amend `apps/web/app/(platform-shell)/provisioning/new/page.tsx`'s `SuccessSummary`: add
  a link/button back to `/tenants` so a newly provisioned tenant is reachable from the list without a
  manual refresh (FR-004). Depends on T015. (Frontend — needs UI-UX-Pro-Max skill)

**Checkpoint**: User Story 1 is fully functional and independently testable — the Tenants list exists,
is Super-Admin-only, and links to tenant creation.

---

## Phase 4: User Story 2 - Edit a Tenant's Company Details (Priority: P1)

**Goal**: A Super Admin edits an existing tenant's company details, including a validated subdomain
change.

**Independent Test**: `PATCH /tenants/:id` with a new primary contact email, confirm it persists and
appears in the list; `PATCH` with a taken/reserved subdomain, confirm `409` and no change
(quickstart.md Scenario 3).

### Tests for User Story 2

- [X] T018 [P] [US2] Write `apps/api/tests/integration/tenant-management-edit.test.ts`: edits name,
  industry, and primary contact; asserts the change persists and is visible via `listTenants` (FR-005).
- [X] T019 [P] [US2] Write `apps/api/tests/integration/tenant-management-edit-subdomain-conflict.test.ts`:
  editing to a subdomain already used by another seeded tenant, and separately to a reserved word,
  both return `409` with the subdomain left unchanged, reusing the same error path as
  `POST /provisioning/tenants` (FR-006).
- [X] T020 [P] [US2] Write `apps/api/tests/integration/tenant-management-edit-archived-blocked.test.ts`:
  seed a tenant with `archived_at` set directly via SQL (not via the Archive route, keeping this test
  independent of US3), assert `PATCH /tenants/:id` on it returns `409` (FR-012).

### Implementation for User Story 2

- [X] T021 [US2] Implement `editTenant` in `apps/api/src/tenant-management/edit-tenant.ts`: updates
  name/industry/primary-contact fields; if `subdomain` is present and differs from the current value,
  imports and reuses `SubdomainTakenError`/`ReservedSubdomainError` validation from
  `../provisioning/provision-tenant` (research.md §2); rejects with `409` if `archivedAt` or
  `deletionRequestedAt` is set (FR-012); writes a `tenant_action_log` row (`action: "edit"`) in the
  same transaction (FR-016). Depends on T008, T009. (Backend-only)
- [X] T022 [US2] Wire the real `PATCH /tenants/:id` handler in `tenant-management-routes.ts` to T021.
  Depends on T021. (Backend-only)
- [X] T023 [US2] Add an "Edit" row action to `tenants-client.tsx`: opens a `Drawer` form (matching
  `team-settings-client.tsx`'s edit-drawer pattern) prefilled with the tenant's current details, submits
  to `PATCH /platform-api/tenants/:id`, surfaces the `409` subdomain-conflict message inline. Depends
  on T015, T022. (Frontend — needs UI-UX-Pro-Max skill)

**Checkpoint**: User Stories 1 and 2 both work independently.

---

## Phase 5: User Story 3 - Archive a Tenant Without Losing Its Data (Priority: P2)

**Goal**: A Super Admin archives a tenant (immediately blocking its users, preserving its data) and can
reverse the archive later.

**Independent Test**: Archive a tenant, confirm an already-established session for that tenant's user
is rejected on its very next request, reactivate, confirm all prior data intact (quickstart.md
Scenario 4).

### Tests for User Story 3

- [X] T024 [P] [US3] Write `apps/api/tests/integration/tenant-management-archive.test.ts`: archiving
  sets `archived_at`, bulk-revokes that tenant's `user_sessions` rows (`revoked_at` set); reactivating
  clears `archived_at`; the tenant's departments/users/records are byte-for-byte unchanged across the
  round trip (FR-007, FR-008; SC-004).
- [X] T025 [P] [US3] Write `apps/api/tests/integration/tenant-management-archive-noop.test.ts`:
  archiving an already-archived tenant returns `200` and does not error or double-write
  `tenant_action_log` in a way that breaks idempotency (FR-009).
- [X] T026 [P] [US3] Write `apps/api/tests/integration/tenant-management-archive-session-block.test.ts`:
  establish a real tenant-user session first, then archive the tenant via the route, then replay a
  request with that same session cookie against `tenant-user-context.ts`'s consuming logic — assert it
  is rejected immediately, proving the T009 foundational amendment, not merely relying on next-login
  denial (FR-007; SC-007).

### Implementation for User Story 3

- [X] T027 [US3] Implement `archiveTenant`/`reactivateTenant` in
  `apps/api/src/tenant-management/archive-tenant.ts`: within one transaction via
  `request.superAdminDb`, set/clear `archivedAt`, bulk-`UPDATE user_sessions SET revoked_at = now()
  WHERE tenant_id = :id AND revoked_at IS NULL` (archive only; reactivate does not touch sessions),
  no-op if already in the target state (FR-009), writes a `tenant_action_log` row (`action: "archive"`
  or `"reactivate"`) (research.md §3, §8; FR-016). Depends on T008, T009, T006. (Backend-only)
- [X] T028 [US3] Wire the real `POST /tenants/:id/archive` and `/reactivate` handlers in
  `tenant-management-routes.ts` to T027. Depends on T027. (Backend-only)
- [X] T029 [US3] Add "Archive"/"Reactivate" row actions to `tenants-client.tsx`, with a lightweight
  confirmation step for Archive (not a full type-to-confirm dialog — reversible, lower risk than
  Delete). Depends on T015, T028. (Frontend — needs UI-UX-Pro-Max skill)

**Checkpoint**: User Stories 1–3 all work independently.

---

## Phase 6: User Story 4 - Downgrade a Tenant's Status (Priority: P2)

**Goal**: A Super Admin steps an Active tenant back to Trial.

**Independent Test**: Downgrade an Active tenant, confirm status becomes Trial with data/users
untouched; attempt to downgrade again, confirm `409` (quickstart.md Scenario 5).

### Tests for User Story 4

- [X] T030 [P] [US4] Write `apps/api/tests/integration/tenant-management-downgrade.test.ts`: a tenant
  seeded at `active` downgrades to `trial` with no other field changed; downgrading it again returns
  `409` (FR-010, FR-011).
- [X] T031 [P] [US4] Write
  `apps/api/tests/integration/tenant-management-downgrade-archived-blocked.test.ts`: a tenant with
  `archived_at` set directly via SQL returns `409` on downgrade (FR-012).

### Implementation for User Story 4

- [X] T032 [US4] Implement `downgradeTenant` in `apps/api/src/tenant-management/downgrade-tenant.ts`:
  fixed `active` → `trial` transition only; `409` if already `trial` or if `archivedAt`/
  `deletionRequestedAt` is set; writes a `tenant_action_log` row (`action: "downgrade"`) (research.md
  §4; FR-010, FR-011, FR-012, FR-016). Depends on T008, T009. (Backend-only)
- [X] T033 [US4] Wire the real `POST /tenants/:id/downgrade` handler in `tenant-management-routes.ts`
  to T032. Depends on T032. (Backend-only)
- [X] T034 [US4] Add a "Downgrade" row action to `tenants-client.tsx`, disabled/hidden when the tenant
  is already at `trial` or is archived/pending-deletion (mirrors the `409` precondition client-side, per
  FR-011). Depends on T015, T033. (Frontend — needs UI-UX-Pro-Max skill)

**Checkpoint**: User Stories 1–4 all work independently.

---

## Phase 7: User Story 5 - Permanently Delete a Tenant (Priority: P3)

**Goal**: A Super Admin deletes a tenant with an explicit name-confirmation step, can recover it within
a grace period, and it is permanently purged only after that period elapses.

**Independent Test**: Delete with a mismatched confirmation name (rejected, unchanged), delete with the
correct name (pending-deletion, unreachable, sessions revoked), recover within the grace period (fully
restored), and — with `deletion_purge_at` backdated in a test DB — run the purge script and confirm
permanent removal (quickstart.md Scenarios 6–7).

### Tests for User Story 5

- [X] T035 [P] [US5] Write
  `apps/api/tests/integration/tenant-management-delete-confirm-mismatch.test.ts`: `confirmTenantName`
  missing or not matching the tenant's current name returns `400`; the tenant is completely unchanged
  (FR-013, FR-014).
- [X] T036 [P] [US5] Write `apps/api/tests/integration/tenant-management-delete.test.ts`: a correct
  confirmation sets `deletion_requested_at`/`deletion_purge_at`, the tenant no longer appears in
  `listTenants`'s default result and is unreachable via `resolveTenantBySubdomain`, and its
  `user_sessions` are bulk-revoked (FR-015; SC-006, SC-007).
- [X] T037 [P] [US5] Write `apps/api/tests/integration/tenant-management-delete-recover.test.ts`:
  recovering a pending-deletion tenant within its grace period clears `deletion_requested_at`/
  `deletion_purge_at` and restores full list/subdomain reachability with all prior data intact
  (FR-015a; SC-008).
- [X] T038 [P] [US5] Write `apps/api/tests/integration/purge-deleted-tenants.test.ts`: seed a tenant
  with `deletion_purge_at` in the past, run the purge script, assert the tenant row and its
  tenant-scoped data (departments, users, sessions) no longer exist, and a subsequent recover attempt
  returns `404` (FR-015b, spec Edge Cases).

### Implementation for User Story 5

- [X] T039 [US5] Implement `deleteTenant`/`recoverTenant` in
  `apps/api/src/tenant-management/delete-tenant.ts`: `deleteTenant` requires `confirmTenantName` to
  exactly match the current `name` (else throws a dedicated error mapped to `400`); on match, sets
  `deletionRequestedAt = now()` and `deletionPurgeAt = now() + <grace period>` (grace-period length read
  from a config constant/env var, default per plan.md Assumptions — flagged for stakeholder sign-off),
  bulk-revokes `user_sessions` (same mechanism as T027); `recoverTenant` clears both columns, `404` if
  the tenant no longer exists (covers both "already purged" and "never existed" identically, per
  contracts/tenant-management-api.md), `409` if not currently pending deletion; both write a
  `tenant_action_log` row (`action: "delete"` / `"delete_recover"`) (FR-013–FR-015a, FR-016). Depends
  on T008, T009, T006. (Backend-only)
- [X] T040 [US5] Wire the real `POST /tenants/:id/delete` and `/recover` handlers in
  `tenant-management-routes.ts` to T039. Depends on T039. (Backend-only)
- [X] T041 [US5] Implement `apps/api/scripts/purge-deleted-tenants.ts` (research.md §5): standalone
  `tsx` script, mirrors `seed-super-admin.ts`'s invocation shape — selects every tenant with
  `deletion_purge_at <= now()`, and for each, permanently deletes the tenant row and its tenant-scoped
  data in its own transaction (FR-015b). Depends on T039. (Backend-only)
- [X] T042 [US5] Add a "Delete" row action to `tenants-client.tsx` with a type-to-confirm dialog
  (input must match the tenant's name before the confirm button enables) and a separate "Recover"
  action for tenants already in the pending-deletion state. Depends on T015, T040. (Frontend — needs
  UI-UX-Pro-Max skill)

**Checkpoint**: All five user stories are independently functional. Feature complete.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T043 [P] Write `apps/api/tests/integration/tenant-management-concurrent-actions.test.ts`: two
  near-simultaneous actions against the same tenant (e.g. archive + downgrade) both apply as
  sequential, consistent state changes — neither silently dropped nor left half-applied (FR-017).
- [X] T044 Run every scenario in `quickstart.md` end-to-end against a local dev stack (`pnpm --filter
  api dev` + `pnpm --filter web dev`) and confirm each documented "Expected" outcome.
- [X] T045 [P] Visually verify `apps/web/app/(platform-shell)/tenants/page.tsx` and its Drawer/dialog
  forms in a browser against `design-system/tm/MASTER.md` (constitution Principle V) — no ad hoc
  styling, consistent with `provisioning/new/page.tsx` and `team-settings-client.tsx`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories (schema, migrations, both new
  RLS policies, and the session-gate amendment every archive/delete-touching story needs).
- **User Stories (Phase 3–7)**: All depend on Foundational completion.
  - US1 and US2 (both P1) have no dependency on each other, but both are recommended before US3–US5
    since they establish the list screen (`tenants-client.tsx`) US3–US5 add row actions to.
  - US3, US4, US5 each depend on `tenants-client.tsx` existing (from US1, T015) for their frontend task
    only — their backend/route tasks (T027–T028, T032–T033, T039–T041) have no dependency on US2–US4
    and could be built in any order or in parallel by different people.
- **Polish (Phase 8)**: Depends on all five user stories being complete.

### Within Each User Story

- Tests are written first (and should fail before implementation, per Tenant Provisioning Core's own
  precedent).
- Backend action function before its route handler; route handler before the frontend row action that
  calls it.
- Each story's checkpoint marks it independently demoable before moving to the next priority.

### Parallel Opportunities

- T002, T003 (Foundational schema files) in parallel.
- T005, T006, T007 (the three post-migration RLS/grant files) in parallel once T004 completes.
- All test tasks within a story phase marked [P] can run in parallel (different files).
- Once Foundational (Phase 2) completes, the backend halves of US2, US3, US4, US5 (T021, T027, T032,
  T039 and their route-wiring tasks) have no cross-story dependency and can proceed in parallel; only
  their frontend tasks (T023, T029, T034, T042) share one file (`tenants-client.tsx`) and must be
  sequenced or merged carefully if worked in parallel.

---

## Parallel Example: User Story 1

```bash
# Tests for User Story 1:
Task: "Write apps/api/tests/integration/tenant-management-list-forbidden.test.ts"
Task: "Write apps/api/tests/integration/tenant-management-list.test.ts"

# Foundational schema, once Setup is done:
Task: "Amend apps/api/src/db/schema/tenants.ts"
Task: "Create apps/api/src/db/schema/tenant-action-log.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational — this is the phase that matters most to get right (schema + the two
   RLS policies closing research.md §8's gap).
3. Complete Phase 3: User Story 1 — a working, Super-Admin-only Tenants list linking to tenant creation.
4. **STOP and VALIDATE**: run quickstart.md Scenarios 1–2 independently.
5. Deploy/demo if ready — this alone is a coherent, demoable slice (replaces the old "Provision Tenant"
   nav destination with a real console entry point).

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → Tenants list exists (MVP, demoable).
3. US2 → tenant details can be corrected without engineering involvement.
4. US3 → tenants can be safely paused and resumed.
5. US4 → tenant status can be stepped down.
6. US5 → tenants can be removed, with a safety net.
7. Polish → concurrency guarantee proven, full quickstart run, design-system visual check.

---

## Notes

- [P] tasks = different files, no dependencies.
- [Story] label maps task to specific user story for traceability.
- The Foundational phase's RLS work (T005, T006) is the highest-risk part of this feature — it's the
  first time any route in this codebase queries `tenants` or `user_sessions` outside a single
  `app.tenant_id` scope. Get T011 (the list-returns-both-seeded-tenants test) green before trusting any
  later story's tests.
- Commit after each task or logical group.
- Stop at any checkpoint to validate a story independently.
