---
description: "Task list template for feature implementation"
---

# Tasks: Training Needs Analysis (TNA)

**Input**: Design documents from `/specs/014-training-needs-analysis/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/training-needs-api.md, quickstart.md — all present.

**Tests**: Included. Not explicitly requested by the spec, but every sibling feature this plan mirrors
(Department, Team Directory, Custom Fields Framework) shipped with integration tests as part of its
own task list, and plan.md's Project Structure already commits to three specific test files — omitting
them here would be an unexplained deviation from established project convention, not a simplification.

**Organization**: Tasks are grouped by user story (spec.md: US1 = P1, US2 = P2, US3 = P3) to enable
independent implementation and testing of each.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths are exact, from plan.md's Project Structure

## Path Conventions

Existing pnpm/Turborepo monorepo — no new top-level project. Backend: `apps/api/src/`,
`apps/api/drizzle/`, `apps/api/tests/integration/`. Frontend: `apps/web/app/(dashboard-shell)/`.

---

## Phase 1: Setup

- [x] T001 Feature branch `014-training-needs-analysis` checked out from a clean `master` (Constitution Principle X) — already done this session.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Table, RLS, Custom Fields Framework registration, permissions, and the shared visibility
helper — every user story depends on all of these existing first.

**⚠️ CRITICAL**: No user story task may begin until this phase is complete.

- [x] T002 Add `trainingNeeds` Drizzle table definition in `apps/api/src/db/schema/training-needs.ts` per data-model.md (`id`, `tenant_id`, `department_id` FK `departments.id` `RESTRICT`, `title`, `priority` `CHECK IN ('low','medium','high')`, `status` `CHECK IN ('draft','submitted')` default `'draft'`, `created_by_user_id` FK `users.id` `SET NULL`, `submitted_at`, `created_at`/`updated_at`, plus the two indexes `(tenant_id, department_id)` and `(tenant_id, status)`)
- [x] T003 Generate and hand-check migration `apps/api/drizzle/0045_training_needs_table.sql` (`CREATE TABLE training_needs`) from T002 via `pnpm --filter api db:generate` — hand-stripped two spurious `users` column-add statements the generator proposed re-running (already applied by `0039`/`0044`; stale pre-`0045` snapshot, now fixed going forward)
- [x] T004 Add migration `apps/api/drizzle/0046_rls_training_needs.sql` — `ENABLE`/`FORCE ROW LEVEL SECURITY` + `tenant_isolation` policy on `training_needs`, using the hardened `NULLIF(...)` cast (`0032`), matching `0034`'s post-hardening convention rather than `0010`'s original (depends on T003)
- [x] T004a Add migration `apps/api/drizzle/0047_lock_training_needs_grants.sql` — `GRANT SELECT, INSERT, UPDATE, DELETE ON training_needs TO tm_app`, mirrors `0012_lock_department_catalog_grants.sql` (not in the original plan — discovered during implementation that every new tenant-scoped table needs its own grant migration, RLS policies alone are insufficient) (depends on T004)
- [x] T005 [P] Add migration `apps/api/drizzle/0048_seed_tna_form_definition.sql` — `INSERT INTO form_definitions (key, name, description) VALUES ('training_needs_analysis', 'Training Needs Analysis', 'Department-level training and skill-gap requests.')`, mirrors `0030_seed_department_form_definition.sql`
- [x] T006 Add migration `apps/api/drizzle/0049_seed_tna_system_fields.sql` — `INSERT INTO form_fields` four `is_system = true`, `tenant_id = NULL`, `created_by = 'system'` rows (`title`, `priority`, `department_id`, `status`) scoped to the `training_needs_analysis` form definition, mirrors `0036_seed_department_system_fields.sql` (depends on T005)
- [x] T007 [P] Add migration `apps/api/drizzle/0050_seed_tna_permissions.sql` — `INSERT INTO permissions` for `tna.view.all`, `tna.view.department`, `tna.manage.all`, `tna.manage.department`; `INSERT INTO role_template_permissions` (`tna.view.all`+`tna.manage.all` → `hr_admin`, `tna.view.department`+`tna.manage.department` → `manager`); idempotent `NOT EXISTS`-gated backfill `INSERT INTO role_permissions` for every already-live tenant role sourced from those templates — mirrors `0040_seed_team_view_permissions.sql` exactly
- [x] T008 Apply all pending migrations (`pnpm --filter api db:migrate`) and confirm `training_needs`, its RLS policy, grants, the `training_needs_analysis` form definition, its four system fields, and the four new permissions (backfilled onto 1176/1272 already-live tenant roles) all exist — verified directly via `psql` (depends on T004, T004a, T006, T007)
- [x] T009 [P] Implement `resolveTrainingNeedVisibilityScope(tenantDb, callerUserId, hasViewAll)` in `apps/api/src/training-needs/training-need-visibility.ts` — returns `{kind:"all"}` / `{kind:"department", departmentIds}` / `{kind:"no_department_assigned"}`, calling the existing unmodified `collectSubtreeIds()` from `apps/api/src/departments/department-hierarchy.ts`, structurally identical to `resolveTeamVisibilityScope()` in `apps/api/src/tenant-auth/team-visibility.ts` (research.md §2) (depends on T002)
- [x] T010 Created `apps/api/src/training-needs/tenant-training-needs-routes.ts` as a Fastify plugin and registered it in `apps/api/src/server.ts` alongside the existing department/team/custom-fields plugin registrations — built with full route handlers directly (T011-T015/T020-T022) rather than as an empty scaffold, since the file's shared helpers (`hasPermission`, `isWithinScope`, `isVisible`, `selectRow`) were clearer to design once, together (depends on T002)

**Checkpoint**: Table, RLS, form registration, permissions, and visibility helper all exist. User story implementation can begin.

---

## Phase 3: User Story 1 - Department Manager submits a training-need request (Priority: P1) 🎯 MVP

**Goal**: A Manager can create a training-need entry for their own department, save it as Draft, submit it, keep editing after submission, and delete only their own Drafts — all from `/learning/tna`.

**Independent Test**: As a Manager-role user scoped to a department, open `/learning/tna`, create an entry, save as Draft, reopen and submit it, edit it again after submission, and confirm a second Draft can be deleted while the Submitted one cannot.

### Implementation for User Story 1

- [x] T011 [US1] Add `POST /tenant/training-needs` handler in `apps/api/src/training-needs/tenant-training-needs-routes.ts` — `requireAnyPermission("tna.manage.all", "tna.manage.department")`; department auto-scope/lock for `tna.manage.department`-only callers (403 on mismatch); `manage.all` callers validate an explicit `departmentId` via `departmentIsActive` (reused from `team-write-validation.ts`); `status` defaults `"draft"`; if `status:"submitted"` passed at creation, validate required custom fields via `validateCustomFieldValues` before insert and set `submitted_at` (contracts/training-needs-api.md)
- [x] T012 [US1] Add `GET /tenant/training-needs` handler, department-scoped branch, in the same file — resolves `resolveTrainingNeedVisibilityScope`, for `{kind:"department"}` returns Draft+Submitted rows within the caller's subtree, for `{kind:"no_department_assigned"}` returns `[]` (depends on T011, T009)
- [x] T013 [US1] Add `GET /tenant/training-needs/:trainingNeedId` handler in the same file — 404 if outside the caller's resolved scope via `isVisible()` (research.md §9) (depends on T012)
- [x] T014 [US1] Add `PATCH /tenant/training-needs/:trainingNeedId` handler in the same file — field edits (title/priority) allowed in any status without resetting it; `status:"submitted"` only legal from `"draft"`, re-validates required custom fields, sets `submitted_at`; already-submitted → submitted is a no-op `200`; out-of-scope caller blocked (404) via `isWithinScope()` (depends on T013)
- [x] T015 [US1] Add `DELETE /tenant/training-needs/:trainingNeedId` handler in the same file — `tna.manage.department`-only caller may delete only if `status = 'draft'` and within their subtree (403 if Submitted, 404 if out of subtree); `tna.manage.all` branch (any status/department) built together with this handler, not separately (depends on T013)
- [x] T016 [P] [US1] Create `apps/web/app/(dashboard-shell)/learning/tna/page.tsx` — server component reading the tenant session and passing `canViewAll`/`canManageAll`/`canManageDepartment` booleans to the client (matches Department/Team's established pattern — no separate page-level "blocked" state; the client's own 403 handling on its list fetch covers a direct-URL visit with no permission at all, exactly like Department already does)
- [x] T017 [US1] Create `apps/web/app/(dashboard-shell)/learning/tna/training-needs-client.tsx` (list only: department-scoped own entries, Draft+Submitted, unpaginated; row-level Edit/Delete via `RowActionsMenu`, navigating rather than opening a Drawer) plus a **dedicated full-page** create/edit form (product follow-up, research.md §7 — superseded the original Drawer design after it had already shipped and been verified) split across `training-need-form.tsx` (shared client form, two-column grid: Title full-width, Priority/Department paired, tenant custom fields via `formKey=training_needs_analysis` mirroring `layoutFields`/`customFieldValues` per research.md §6, wide fields like textarea/multiselect spanning both columns), `new/page.tsx`, and `[id]/page.tsx` — Department shown only as a picker for `tna.manage.all` creating a new entry, shown read-only as a subtitle when editing; "Save as draft"/"Submit" (Draft) or "Save changes" (Submitted) actions at the bottom of the page
- [x] T018 [US1] Added a permission-gated "Learning" `NavSection` (child: "Training Needs Analysis" → `/learning/tna`) to `apps/web/app/(dashboard-shell)/layout.tsx`, following the exact `if (canX) { navSections.push(...) }` pattern already used for "Administration" — left the existing disabled `courses` placeholder untouched (research.md §8). Added two new icon keys (`graduationCap`, `clipboardList`) to `packages/ui/src/app-shell.tsx`'s `ICONS` registry, extending it per its own documented convention.
- [x] T019 [P] [US1] Integration test `apps/api/tests/integration/training-needs-permission-gating.test.ts` — covers create → draft → submit → edit-after-submit → delete-own-draft-succeeds → delete-submitted-blocked → no-permission-blocked → invalid priority/missing title (mirrors `department-permission-gating.test.ts`) (depends on T011-T015). Also updated two pre-existing tests (`seed-default-roles.test.ts`, `provision-tenant-admin-role.test.ts`) that hardcode the full `hr_admin` permission list — the same precedent-following update every prior permission-adding spec (`0040`, `0042`) already required.

**Checkpoint**: User Story 1 is fully functional and independently testable — a Manager's end-to-end flow works.

---

## Phase 4: User Story 2 - HR/L&D Admin views and manages every department's submissions (Priority: P2)

**Goal**: An HR/L&D Admin sees every department's Submitted (never Draft) entries in one filterable, paginated list, and can edit or delete any of them regardless of department.

**Independent Test**: As a `tna.view.all` holder, open `/learning/tna`, confirm Submitted entries from multiple departments are visible (and a Draft from Story 1 is not), filter by department and priority, then edit and delete an entry belonging to a department the admin doesn't manage directly.

### Implementation for User Story 2

- [x] T020 [US2] Org-wide branch of `GET /tenant/training-needs` in `apps/api/src/training-needs/tenant-training-needs-routes.ts`: for `{kind:"all"}`, returns **Submitted-only** rows across every department, paginated (`page`/`pageSize`), filterable by `department` (hierarchy-aware via `collectSubtreeIds`) and `priority` query params (depends on T012)
- [x] T021 [US2] `tna.manage.all` branch of `DELETE /tenant/training-needs/:trainingNeedId` in the same file — deletes any row regardless of status or department, no subtree/status check (depends on T015)
- [x] T022 [US2] `PATCH /tenant/training-needs/:trainingNeedId` uses `resolveTrainingNeedVisibilityScope(..., manageAll)` so a `tna.manage.all` holder's scope is `{kind:"all"}`, which `isWithinScope()` always passes — bypasses the department-subtree restriction by construction, no separate branch needed (depends on T014)
- [x] T023 [US2] `training-needs-client.tsx` (T017) already branches its table/filters on `canViewAll` — department/priority filter selects, a Department column, and `Pagination` (@tm/ui) render only for `tna.view.all`; the same `training-need-form.tsx` full page (T017) handles editing any department's entry when `tna.manage.all` (Team Directory's list shape, research.md §7) (depends on T017, T020-T022)
- [x] T024 [P] [US2] Integration test `apps/api/tests/integration/training-needs-visibility.test.ts` — covers org-wide Submitted-only visibility (Draft excluded from `tna.view.all`), `tna.manage.all` editing/deleting a Draft directly by id and any Submitted entry, department-subtree scoping for `tna.view.department` (parent/child/unrelated departments), cross-department detail/edit access returns 404 (mirrors Team Directory's visibility tests) (depends on T020-T022)

**Checkpoint**: User Stories 1 and 2 both work independently — Manager submission and HR oversight are both demoable.

---

## Phase 5: User Story 3 - HR/L&D Admin adds custom fields to the TNA form (Priority: P3)

**Goal**: An HR/L&D Admin adds a tenant-specific field (e.g. "Function") to the TNA form via the existing Settings > Forms screen, and it appears on the next Manager's create form in the correct order.

**Independent Test**: As a `forms.manage.tenant` holder, open Settings > Forms, select "Training Needs Analysis" (now selectable — Foundational's T005 seeded the row), add a field, then confirm it renders on `/learning/tna`'s create form after the fixed fields, with its required/type validation enforced on submit.

### Implementation for User Story 3

- [x] T025 [US3] Verified `apps/web/app/(dashboard-shell)/settings/forms/forms-settings-client.tsx` fetches `GET /tenant/form-definitions` and lists whatever rows come back — no hardcoded form-type list, no file change needed. "Training Needs Analysis" is selectable there automatically now that `0048_seed_tna_form_definition.sql` is applied.
- [x] T026 [US3] Confirmed `training-needs-client.tsx` (T017) already renders newly tenant-added `training_needs_analysis` custom fields via the same generic `layoutFields.filter(f => !f.isSystem)` + `renderCustomField` pattern Department/Team use — no gap found, no adjustment needed (depends on T017, T025)
- [x] T027 [P] [US3] Integration test `apps/api/tests/integration/custom-fields-tna-integration.test.ts` — covers adding a tenant field via `POST /tenant/form-fields?formKey=training_needs_analysis`, its correct ordering after the four system fields in `GET /tenant/form-fields`, required-field validation enforced on submit (both `POST` and `PATCH .../training-needs`), and correct persistence via `GET /tenant/custom-field-values` (mirrors `custom-fields-department-integration.test.ts`) (depends on T011, T014, T025)

**Checkpoint**: All three user stories are independently functional — the feature is complete per spec.md.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T028 [P] Ran `pnpm --filter api type-check` and `pnpm --filter web type-check` — both clean, no errors
- [x] T029 [P] Ran `pnpm --filter api lint` and `pnpm --filter web lint` — both clean, no warnings or errors. Also ran the full API test suite (`pnpm --filter api test`): 91 files / 163 tests passing, including the 7 new TNA tests and 2 pre-existing tests updated for the new `tna.*` permissions.
- [x] T030 Ran the quickstart.md flow end-to-end in a real browser against a seeded local tenant (subdomain `tna-smoke`, since removed): logged in as a Manager, created a training need, saved as Draft, reopened and Submitted it, confirmed the Drawer/Badge/RowActionsMenu render correctly and the Draft-only delete restriction is enforced in the UI (menu shows no Delete for a Submitted row); logged in as HR/L&D Admin, confirmed "Training Needs Analysis" is selectable in Settings > Forms, added a required "Function" tenant field that rendered correctly ordered after the four system fields, and confirmed the org-wide list (department/priority filters, Department column, pagination, Delete available on a Submitted row). No console errors beyond a harmless browser-extension-induced hydration warning unrelated to this feature.
- [ ] T031 Confirm the Constitution Principle VI plan-tier assumption flagged in plan.md (TNA ships on all tiers, unlike AI Course Generation) is correct before considering this feature done — **left open for stakeholder confirmation, not a code task.**

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Done.
- **Foundational (Phase 2)**: Blocks all user stories — T002 → T003 → T004; T002 → T009; T002 → T010; T005 → T006; T003/T004/T006/T007 → T008.
- **User Stories (Phase 3–5)**: All require Foundational complete. US2 (Phase 4) builds directly on US1's route file (T012, T014, T015) and client component (T017) — not independent of US1's *code*, but independently *testable* once both are in place, per spec.md's own framing (US2's value only exists once US1 has produced data to view). US3 (Phase 5) only needs Foundational (T005/T006) plus US1's client component (T017) to attach to.
- **Polish (Phase 6)**: After all desired user stories are complete.

### Within Each User Story

- Route handlers before the client component that calls them.
- Client component before the nav entry that links to it (though T018 only needs the route `/learning/tna` to exist, so it could run in parallel with T017 in practice — kept sequential here for clarity).
- Integration test after the handlers it covers.

### Parallel Opportunities

- T005 and T007 (independent migration content) can be authored in parallel with each other and with T003/T004.
- T009 (visibility helper) can be built in parallel with T003–T008 (migrations) once T002 (schema) lands.
- T016 (page.tsx) can be built in parallel with T011–T015 (route handlers).
- T019, T024, T027 (integration tests, different files) can be authored in parallel with each other once their respective handlers exist.

---

## Parallel Example: Foundational Phase

```bash
# After T002 (schema) lands, these can run together:
Task: "Add migration apps/api/drizzle/0047_seed_tna_form_definition.sql"
Task: "Add migration apps/api/drizzle/0049_seed_tna_permissions.sql"
Task: "Implement resolveTrainingNeedVisibilityScope() in apps/api/src/training-needs/training-need-visibility.ts"
```

## Parallel Example: User Story 1

```bash
Task: "Create apps/web/app/(dashboard-shell)/learning/tna/page.tsx"
# ...while route handlers T011-T015 are built in tenant-training-needs-routes.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (done) and Phase 2 (Foundational).
2. Complete Phase 3 (User Story 1).
3. **STOP and VALIDATE**: run quickstart.md Scenarios 2 and 4 (Manager create/draft/submit/edit/delete-own-draft) independently.
4. Demo: a Manager's end-to-end TNA submission flow, with no HR-facing screen yet.

### Incremental Delivery

1. Foundational → schema/RLS/permissions/form registration exist, nothing user-facing yet.
2. Add User Story 1 → Manager flow demoable (MVP).
3. Add User Story 2 → HR org-wide oversight demoable (quickstart Scenario 3).
4. Add User Story 3 → tenant field customization demoable (quickstart Scenario 1).
5. Polish → type-check, lint, full quickstart pass, plan-tier confirmation.

---

## Notes

- [P] tasks touch different files with no unmet dependency.
- [Story] labels map every Phase 3+ task to spec.md's US1/US2/US3.
- T012/T014/T015/T017 are each touched by more than one story (US1 creates them, US2 extends them) — this is expected given US2's value is additive on top of US1's data model, not a violation of independence; US2 remains independently *testable* once US1's code exists.
- Commit after each task or logical group; stop at either checkpoint to validate a story independently before continuing.
