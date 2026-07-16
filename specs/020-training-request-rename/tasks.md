---

description: "Task list template for feature implementation"
---

# Tasks: Training Request Rename

**Input**: Design documents from `/specs/020-training-request-rename/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Test tasks are included — the spec's User Story 2 explicitly requires a migration-safety
test (FR-005/SC-002), and existing integration tests assert against the permission-key literals
being renamed, so they must be updated for the suite to keep passing.

**Organization**: Tasks are grouped by user story (spec.md) to enable independent implementation and
testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Paths are exact, taken from the current repo (no placeholders)

## Path Conventions

Existing pnpm/Turborepo monorepo, two apps: `apps/api/` (Fastify + Drizzle) and `apps/web/`
(Next.js App Router). No new project or package is introduced.

---

## Phase 1: Setup

**Purpose**: Get a clean starting point for the feature per Constitution Principle X

- [X] T001 Create branch `020-training-request-rename` from a clean base branch (no uncommitted
      work pending) — this repo has no `before_specify`/`before_plan` git hook
      (`.specify/extensions.yml` does not exist), so no branch was auto-created during
      `/speckit-specify`/`/speckit-plan`

---

## Phase 2: Foundational

**No foundational tasks required.** This feature adds no new table, dependency, or shared
infrastructure — every task below is scoped to an existing file from Feature 014. User Stories 1
and 2 are fully independent of each other (see Dependencies below); proceed directly to Phase 3.

---

## Phase 3: User Story 1 - See accurate "Training Request" labeling everywhere (Priority: P1) 🎯 MVP

**Goal**: Every screen and notification that said "Training Needs Analysis" / "Training Need(s)"
now says "Training Request(s)", with no change to permissions, routing, or data.

**Independent Test**: Deploy this phase alone (permission keys and route still unchanged) and
navigate every screen listed below — confirm updated copy renders and every existing feature
(submit, edit, approve, list) still works exactly as before, since nothing here touches logic.

### Implementation for User Story 1

- [X] T002 [P] [US1] Update nav label in `apps/web/app/(dashboard-shell)/layout.tsx:97` from
      `"Training Needs Analysis"` to `"Training Requests"` (text only — do not touch the
      `canAccessTna` permission checks a few lines above; that's User Story 2's concern)
- [X] T003 [P] [US1] Update copy in
      `apps/web/app/(dashboard-shell)/learning/tna/training-need-form.tsx`: the heading at line 387
      (`"Training Needs Analysis"` → `"Training Request"`), the page title logic at line 393
      (`"Edit training need"`/`"New training need"` → `"Edit training request"`/
      `"New training request"`), the subtitle copy at lines 398-399 (`"Create a training need
      for..."` → `"Create a training request for..."`), and the three error-message strings at
      lines 105, 112, 194 (`"training need"` → `"training request"`)
- [X] T004 [P] [US1] Update copy in
      `apps/web/app/(dashboard-shell)/learning/tna/training-needs-client.tsx`: the `PageHeader
      title` at line 248 (`"Training Needs Analysis"` → `"Training Requests"`), the description
      line at lines 242-243, the "New training need" button label at line 252, the empty-state
      copy at lines 304-305, the delete-confirmation text at line 373, and the error strings at
      lines 200, 213, 238 (all `"training need(s)"` → `"training request(s)"`)
- [X] T005 [P] [US1] Update copy in
      `apps/web/app/(dashboard-shell)/learning/tna/[id]/training-need-view.tsx`: the heading at
      line 147 (`"Training Needs Analysis"` → `"Training Request"`) and the error strings at lines
      92, 98, 136, 153 (`"training need"` → `"training request"`)
- [X] T006 [US1] Confirm no notification/email template references "Training Need" — verified via
      `grep -in "training" apps/api/src/mail/email-templates.ts apps/api/src/tenant-auth/mailer.ts`
      returning no matches as of this plan; re-run the same check and only edit those files if a
      match now exists (spec Assumptions: trivially satisfied otherwise)
- [X] T007 [US1] Run `quickstart.md` §2 ("User-facing labeling") end-to-end and confirm every listed
      screen shows "Training Request(s)" copy. **Validated via**: line-by-line review of every
      edited string (T003-T005) plus a clean `next build` (see T028 note) confirming no
      compile-time regression; a live interactive browser walkthrough was not performed in this
      environment (no running tenant session available), so re-confirm visually on first deploy

**Checkpoint**: User Story 1 is fully functional and independently deployable — labeling is correct
everywhere, no permission or routing behavior has changed.

---

## Phase 4: User Story 2 - Existing tenants keep exactly the access they already have (Priority: P1)

**Goal**: The five permission keys gating this feature are renamed from `tna.*` to
`training_request.*`, with every existing tenant role's grant set numerically and functionally
identical before and after.

**Independent Test**: Deploy this phase alone (copy still says "Training Needs Analysis", route
still `/learning/tna`) and, per `quickstart.md` §1, confirm a role that held `tna.*` permissions
holds the equivalent `training_request.*` permissions post-migration with zero re-granting, and
that every previously-permitted action (view/manage/approve) still works.

### Tests for User Story 2

- [X] T008 [US2] Create `apps/api/tests/integration/training-request-permission-migration.test.ts`.
      **Implementation note**: the test DB is migrated once, ahead of the whole suite, so by the
      time any test runs migration 0057 has already applied — there is no live "seed old tna.*
      grants, then run the migration" moment to capture. Instead the test asserts (a) the
      migration's declared end state (the 5 `training_request.*` keys exist, none of the 5 old
      `tna.*` keys remain) and (b) the underlying grant-preservation mechanism generically, via a
      synthetic `permissions.key` rename performed and asserted entirely inside a transaction that
      is always rolled back (never committed), so it leaves no permanent trace on the shared
      `permissions` table other tests depend on

### Implementation for User Story 2

- [X] T009 [US2] Create migration `apps/api/drizzle/0057_rename_tna_permissions_to_training_request.sql`
      (verify `0057` is still the next available index in
      `apps/api/drizzle/meta/_journal.json` before creating — it was the next free slot as of this
      plan) containing five `UPDATE "permissions" SET "key" = '<new>', "display_name" = ...,
      "description" = ... WHERE "key" = '<old>'` statements for `tna.view.all`, `tna.view.department`,
      `tna.manage.all`, `tna.manage.department`, `tna.approve` → their `training_request.*`
      equivalents (contracts/permission-keys.md has the full mapping) — no `DELETE`/`INSERT`, per
      FR-005. Add the matching entry to `apps/api/drizzle/meta/_journal.json`, mirroring how
      `0050_seed_tna_permissions` / `0052_seed_tna_approve_permission` were registered.
- [X] T010 [US2] Update the ~15 permission-key string-literal occurrences in
      `apps/api/src/training-needs/tenant-training-needs-routes.ts` from `tna.*` to
      `training_request.*` (every `requirePermission`/`requireAnyPermission`/`hasPermission` call
      site across the list, get-one, create, update, approve, and delete route handlers)
- [X] T011 [P] [US2] Update the doc-comment references to `tna.*` keys in
      `apps/api/src/training-needs/training-need-visibility.ts` (lines ~14-16) to
      `training_request.*`
- [X] T012 [P] [US2] Update the doc-comment reference to `tna.approve` in
      `apps/api/src/db/schema/training-needs.ts` (line ~34) to `training_request.approve`
- [X] T013 [US2] Update the `canAccessTna` permission checks in
      `apps/web/app/(dashboard-shell)/layout.tsx` (lines ~64-69, the five `.includes("tna....")`
      calls) to `training_request.*` — same file as T002; land this after or alongside T002 to
      avoid re-diffing the same block twice
- [X] T014 [P] [US2] Update the permission checks in
      `apps/web/app/(dashboard-shell)/learning/tna/page.tsx` (lines 15-24: `tna.view.all`,
      `tna.manage.all`, `tna.approve`, plus the two explanatory comments) to `training_request.*`
- [X] T015 [P] [US2] Update the permission checks in
      `apps/web/app/(dashboard-shell)/learning/tna/new/page.tsx` (lines 12-13: `tna.manage.all`,
      `tna.manage.department`) to `training_request.*`
- [X] T016 [P] [US2] Update the permission checks in
      `apps/web/app/(dashboard-shell)/learning/tna/[id]/page.tsx` (lines 17-21: `tna.manage.all`,
      `tna.manage.department`, `tna.view.all`, `tna.view.department`, `tna.approve`) to
      `training_request.*`
- [X] T017 [P] [US2] Update the permission checks in
      `apps/web/app/(dashboard-shell)/learning/tna/[id]/edit/page.tsx` (lines 17-18:
      `tna.manage.all`, `tna.manage.department`) to `training_request.*`
- [X] T018 [P] [US2] Update the 7 `tna.*` literal occurrences in
      `apps/api/tests/integration/training-needs-visibility.test.ts` to `training_request.*`
- [X] T019 [P] [US2] Update the 8 `tna.*` literal occurrences in
      `apps/api/tests/integration/training-needs-approval.test.ts` to `training_request.*`
- [X] T020 [P] [US2] Update the 5 `tna.*` literal occurrences in
      `apps/api/tests/integration/training-needs-permission-gating.test.ts` to `training_request.*`
- [X] T021 [P] [US2] Update the 3 `tna.*` literal occurrences in
      `apps/api/tests/integration/seed-default-roles.test.ts` to `training_request.*`
- [X] T022 [P] [US2] Update the 3 `tna.*` literal occurrences in
      `apps/api/tests/integration/provision-tenant-admin-role.test.ts` to `training_request.*`
- [X] T023 [P] [US2] Update the 1 `tna.*` literal occurrence in
      `apps/api/tests/integration/custom-fields-tna-integration.test.ts` to `training_request.*`
- [X] T024 [US2] Run `quickstart.md` §1 ("Permission continuity") end-to-end against a real seeded
      tenant role and confirm zero grant regressions. **Validated via**: a fresh, isolated Postgres
      container (not the shared local dev DB — see note below) migrated from scratch through 0057;
      confirmed the 5 `training_request.*` keys exist and all 5 old `tna.*` keys are gone; ran the
      full `pnpm --filter api test` suite against it — 221/222 passing (the 1 failure,
      `zeptomail-sender.test.ts`, is pre-existing and unrelated to this feature — confirmed via
      `git diff`/`git status`, untouched by any task here). **Environment note**: the project's
      long-running local dev Postgres (`tm-postgres-1`, docker-compose) was found to already have 7
      migrations applied beyond what this branch's `drizzle/` folder defines (ids 58-64, unrelated
      history, likely from other work on a different branch) — running `db:migrate` against it was
      a safe no-op (drizzle-kit detected no new migration to apply given the mismatch) and it was
      left untouched rather than forced; a throwaway container was used instead for real validation

**Checkpoint**: User Story 2 is fully functional and independently deployable — every existing
tenant's access is verified unchanged under the new permission-key names.

---

## Phase 5: User Story 3 - Old bookmarked links still work (Priority: P3)

**Goal**: The feature's route moves from `/learning/tna` to `/learning/training-requests`, and
every old-path request (list, create, view, edit) redirects to the equivalent new-path page.

**Independent Test**: Per `quickstart.md` §3, visit each old URL and confirm a redirect to the
corresponding new URL showing the same record.

**Dependency note**: This phase relocates the same files User Story 1 (T003-T005) and User Story 2
(T014-T017) edit. Land US1 and US2 first (their content changes apply at the current `tna/` path),
then perform the directory move last so it carries the already-updated content.

### Implementation for User Story 3

- [X] T025 [US3] `git mv apps/web/app/(dashboard-shell)/learning/tna
      apps/web/app/(dashboard-shell)/learning/training-requests` — moves `page.tsx`,
      `training-needs-client.tsx`, `training-need-form.tsx`, `status.ts`, `new/page.tsx`,
      `[id]/page.tsx`, `[id]/edit/page.tsx`, and `[id]/training-need-view.tsx` together, preserving
      their (by-then-updated) contents. **Expanded scope**: also updated the ~13 hardcoded
      `/learning/tna` internal `router.push`/`redirect()` string literals inside these same moved
      files (discovered during implementation — not itemized in the original task, but required
      for internal navigation to reach the new path directly instead of round-tripping through the
      T027 redirect on every click)
- [X] T026 [US3] Update the nav entry `href` in `apps/web/app/(dashboard-shell)/layout.tsx` (the
      "Learning" section's child entry) from `"/learning/tna"` to `"/learning/training-requests"`
- [X] T027 [US3] Add a `redirects()` export to `apps/web/next.config.ts`, alongside the existing
      `rewrites()`: `{ source: "/learning/tna/:path*", destination:
      "/learning/training-requests/:path*", permanent: false }`
- [X] T028 [US3] Run `quickstart.md` §3 ("Route rename and redirect") end-to-end — visit
      `/learning/tna`, `/learning/tna/new`, `/learning/tna/<id>`, and `/learning/tna/<id>/edit` and
      confirm each redirects to its new-path equivalent showing the same record. **Validated via**:
      ran `next build && next start` and `curl`'d all four old paths directly — each returned
      `307` with the correct `Location` header: `/learning/tna` → `/learning/training-requests`,
      `/learning/tna/new` → `/learning/training-requests/new`, `/learning/tna/abc-123` →
      `/learning/training-requests/abc-123`, `/learning/tna/abc-123/edit` →
      `/learning/training-requests/abc-123/edit`

**Checkpoint**: All three user stories are independently functional — labeling, permissions, and
routing are all fully migrated to "Training Request".

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T029 [P] Update the doc comments referencing "Training Needs Analysis" in
      `apps/web/app/(dashboard-shell)/dashboard/page.tsx` (non-user-facing, cosmetic consistency
      only — not required by any FR)
- [X] T030 Run the full regression suite and confirm no behavioral test needed a logic change
      beyond the permission-key literals: `pnpm --filter api test training-needs` and
      `pnpm --filter api test training-request` (per `quickstart.md` §4 / spec SC-004).
      **Validated via**: full `pnpm --filter api test` (222 tests) against a clean, fully-migrated
      isolated Postgres — 221 passed, 1 pre-existing unrelated failure
      (`zeptomail-sender.test.ts`, untouched by this feature); `pnpm --filter api type-check`,
      `pnpm --filter web type-check`, `pnpm lint` (both packages), and `pnpm --filter web build`
      all clean with zero errors/warnings introduced by this change

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Empty — nothing blocks the user stories below.
- **User Story 1 (Phase 3)**: Can start immediately after Setup. No dependency on US2 or US3.
- **User Story 2 (Phase 4)**: Can start immediately after Setup, in parallel with US1. No
  dependency on US1 (different concern: permission keys, not copy) or US3.
- **User Story 3 (Phase 5)**: Should start after US1 and US2 have landed their edits to the files
  it moves (see Dependency note in Phase 5) — this is a file-ordering concern, not a logical
  blocker; the redirect/route-move itself has no functional dependency on US1/US2's content.
- **Polish (Phase 6)**: After all three user stories are complete.

### Within Each User Story

- US2: the new migration-safety test (T008) is written first, then the migration it exercises
  (T009), then the code call sites that consume the renamed keys (T010-T017), then the existing
  test literal updates (T018-T023), then the end-to-end quickstart check (T024).
- US1 and US3: implementation tasks, each ending with its own quickstart validation task.

### Parallel Opportunities

- T002-T005 (US1) are four different files — fully parallel.
- T011-T012 (US2 doc comments) and T014-T023 (US2 frontend gating + test literals) are each
  different files — fully parallel with each other and with T002-T005, since US1 and US2 touch
  disjoint file sets except `layout.tsx` (T002 vs. T013 — sequence, don't parallelize those two).
- T009 (migration) and T010 (backend route literals) can be done in parallel by different people
  since they're different files, but both must land before T024's end-to-end check is meaningful.

---

## Parallel Example: User Story 1

```bash
Task: "Update nav label in apps/web/app/(dashboard-shell)/layout.tsx:97"
Task: "Update copy in apps/web/app/(dashboard-shell)/learning/tna/training-need-form.tsx"
Task: "Update copy in apps/web/app/(dashboard-shell)/learning/tna/training-needs-client.tsx"
Task: "Update copy in apps/web/app/(dashboard-shell)/learning/tna/[id]/training-need-view.tsx"
```

## Parallel Example: User Story 2 (frontend gating + test literals)

```bash
Task: "Update permission checks in apps/web/app/(dashboard-shell)/learning/tna/page.tsx"
Task: "Update permission checks in apps/web/app/(dashboard-shell)/learning/tna/new/page.tsx"
Task: "Update permission checks in apps/web/app/(dashboard-shell)/learning/tna/[id]/page.tsx"
Task: "Update permission checks in apps/web/app/(dashboard-shell)/learning/tna/[id]/edit/page.tsx"
Task: "Update tna.* literals in apps/api/tests/integration/training-needs-visibility.test.ts"
Task: "Update tna.* literals in apps/api/tests/integration/training-needs-approval.test.ts"
Task: "Update tna.* literals in apps/api/tests/integration/training-needs-permission-gating.test.ts"
Task: "Update tna.* literals in apps/api/tests/integration/seed-default-roles.test.ts"
Task: "Update tna.* literals in apps/api/tests/integration/provision-tenant-admin-role.test.ts"
Task: "Update tna.* literal in apps/api/tests/integration/custom-fields-tna-integration.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 3: User Story 1 (copy-only rename).
3. **STOP and VALIDATE**: run `quickstart.md` §2. Users now see "Training Request" everywhere;
   nothing else has changed.
4. Deploy/demo if ready — this alone resolves the naming-accuracy problem the spec exists to fix.

### Incremental Delivery

1. Setup → (nothing foundational needed).
2. Add User Story 1 → validate → deploy (MVP: correct labeling).
3. Add User Story 2 → validate via `quickstart.md` §1 → deploy (permission keys renamed safely).
4. Add User Story 3 → validate via `quickstart.md` §3 → deploy (route moved, old links redirect).
5. Polish (T029-T030) → final regression pass.

### Parallel Team Strategy

With two developers: Developer A takes US1 (Phase 3, frontend copy only); Developer B takes US2
(Phase 4, migration + permission call sites + tests) at the same time — they only collide on
`layout.tsx` (T002 vs. T013), which is a two-line coordination, not a blocking dependency. US3
(Phase 5) is picked up by whoever finishes first, once both US1 and US2 have merged.
