# Tasks: Extensible Custom Fields Framework

**Input**: Design documents from `/specs/010-custom-fields-framework/`

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
- Backend: `apps/api/src/...`, `apps/api/drizzle/...`, `apps/api/tests/integration/...`
- Frontend: `apps/web/app/(dashboard-shell)/...`, `packages/ui/src/...`

---

## Phase 1: Setup

**Purpose**: Scaffold the new module/route directories. No new dependency is installed (plan.md —
zero new packages required).

- [X] T001 Create the new backend module directory `apps/api/src/custom-fields/`.
- [X] T002 [P] Create the new frontend route directory
      `apps/web/app/(dashboard-shell)/settings/forms/`.
- [X] T003 [P] Confirm local Postgres is up-to-date with every prior migration
      (`pnpm --filter api db:migrate`) before adding new ones in Phase 2.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, RLS, permissions, and the shared query/validation library every user story reads
or writes. `GET /tenant/form-definitions` and `GET /tenant/form-fields` are included here (not deferred
to a single story) because both US1's config screen and US2's Department retrofit need to *read* the
same data — only the *write* endpoints are story-specific.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Create the custom-fields schema in a new
      `apps/api/src/db/schema/custom-fields.ts`: `formDefinitions` (id, key unique, name,
      description, createdAt — no `tenantId`), `formFields` (id, `formDefinitionId` FK →
      `formDefinitions.id` `onDelete: "restrict"`, `tenantId` nullable FK → `tenants.id`
      `onDelete: "restrict"`, `fieldKey`, `label`, `fieldType` text + `check()` constraint for the six
      supported types, `options` jsonb nullable, `isRequired` boolean default false, `displayOrder`
      integer, `createdBy` text + `check()` constraint (`super_admin`/`tenant_admin`), `archivedAt`
      timestamptz nullable, `createdAt`/`updatedAt`), `customFieldValues` (id, `tenantId` FK →
      `tenants.id`, `formDefinitionId` FK → `formDefinitions.id` `onDelete: "restrict"`, `entityId`
      uuid **with no FK** (polymorphic, data-model.md), `fieldId` FK → `formFields.id`
      `onDelete: "restrict"`, `value` jsonb, `createdAt`/`updatedAt`). Add the unique index on
      `formFields (tenantId, formDefinitionId, fieldKey)` and on `customFieldValues (tenantId,
      entityId, fieldId)`. Generate the migration (`pnpm --filter api db:generate`).
- [X] T005 Hand-add to the generated migration SQL: RLS enabled + forced on `form_fields` and
      `custom_field_values`; on `form_fields`, the three composed permissive policies from
      data-model.md — `tenant_isolation` (standard shape), `global_fields_readable`
      (`FOR SELECT USING (tenant_id IS NULL)`), and `super_admin_full_access` (**use
      `current_setting('app.is_super_admin', true) = 'true'`** in both `USING` and `WITH CHECK` — the
      same GUC `apps/api/src/platform-auth/super-admin-context.ts` already sets on every Super Admin
      request, per research.md §1 — this is the only mechanism used anywhere in this feature to check
      for Super Admin access; no route-level `request.superAdmin` check is added, since no Super
      Admin-facing route exists in this spec's scope); on `custom_field_values`, the standard single
      `tenant_isolation` policy. Add grants: `form_definitions` — `SELECT` only to `tm_app`
      (`INSERT`/`UPDATE`/`DELETE` reserved for the migration role, mirroring `permissions`/
      `department_templates`); `form_fields`/`custom_field_values` — full CRUD to `tm_app` (RLS
      enforces the rest). Apply the migration (`pnpm --filter api db:migrate`).
- [X] T006 [P] Add a new migration seeding one `form_definitions` row: `key = 'department'` (data-model.md
      §3 — no `tna` row; Training Needs Analysis has no spec yet).
- [X] T007 [P] Add a new migration seeding `forms.manage.global` / `forms.manage.tenant` permission
      catalog rows (category `forms`), granting `forms.manage.tenant` to the `hr_admin` role template
      *and* backfilling it onto every existing tenant's `HR/L&D Admin`-named role (mirror Spec 009's
      `0025`/`0026` precedent — match by role name, not only `source_template_id`, since most existing
      roles lack that link).
- [X] T008 Implement `apps/api/src/custom-fields/field-validation.ts`: `slugify(label)` (lowercase,
      trim, collapse non-alphanumeric runs to `_`) and `validateFieldValue(field, value)` (checks
      `value`'s shape against `field.fieldType`, and presence when `field.isRequired`) per spec FR-007.
- [X] T009 Implement `apps/api/src/custom-fields/field-key-uniqueness.ts`: `getFormFields(tenantDb,
      formKey)` (the merged, active, ordered field list — global rows first, then the caller's own
      tenant rows, `archivedAt IS NULL` — data-model.md "Merged field list") and
      `fieldKeyCollisionExists(tenantDb, formDefinitionId, fieldKey, excludeFieldId?)` (checks across
      *both* scopes, including archived rows — research.md §2). Depends on T004.
- [X] T010 Implement `apps/api/src/custom-fields/save-values.ts`: `saveCustomFieldValues(tenantDb,
      formKey, entityId, values, fields)` — validates every submitted value via `validateFieldValue`
      (T008) against the provided merged `fields` list, rejects with per-field errors on any failure,
      else upserts one `custom_field_values` row per submitted field (unique on `(tenantId, entityId,
      fieldId)`). Depends on T008, T009.
- [X] T011 Implement `GET /tenant/form-definitions` (gated `forms.manage.tenant`) and
      `GET /tenant/form-fields?formKey=` (gated only `requireTenantUserSession()` — research.md §4) in
      the new `apps/api/src/custom-fields/tenant-form-routes.ts`, using T009's `getFormFields`.
      Response shape per contracts/custom-fields-api.md, including each row's `scope`
      (`"global"`/`"tenant"`). Depends on T009.
- [X] T012 Register the new `tenantFormRoutes` plugin in `apps/api/src/server.ts` alongside the other
      tenant-scoped route plugins. Depends on T011.

**Checkpoint**: Foundation ready — schema, dual-visibility RLS (using `app.is_super_admin` for the
Super Admin allowance, per this feature's explicit instruction), permissions, shared validation/query
library, and both read-only endpoints all exist.

---

## Phase 3: User Story 1 - Tenant Admin extends a form with their own fields (Priority: P1) 🎯 MVP

**Goal**: A user holding `forms.manage.tenant` can open Settings > Forms, see a form type's global and
tenant fields, add a new tenant-scoped field (with auto-suggested key, type, options, required flag),
and reorder it among the tenant's own other fields.

**Independent Test**: As a `forms.manage.tenant` user, open Settings > Forms, select "Department," add
a field, confirm it appears as an editable row, and reorder it against another tenant field —
independent of any other module actually rendering it yet.

### Tests for User Story 1

- [X] T013 [P] [US1] Integration test: creating a field whose key collides with an existing field —
      either another of this tenant's own fields, or a global field — is rejected (`409`), in
      `apps/api/tests/integration/custom-fields-key-collision-cross-scope.test.ts`.

### Implementation for User Story 1

- [X] T014 [US1] Implement `POST /tenant/form-fields` in `tenant-form-routes.ts` (gated
      `forms.manage.tenant`): required `label`/`fieldType`, optional `fieldKey` (else derived via
      T008's `slugify`), `options` required for `select`/`multiselect`, rejects on
      `fieldKeyCollisionExists` (T009), inserts with `tenantId` = caller's own tenant, `createdBy =
      'tenant_admin'`, `displayOrder` appended after this tenant's existing fields for that form.
      Depends on T008, T009.
- [X] T015 [US1] Implement `PATCH /tenant/form-fields/:fieldId` in `tenant-form-routes.ts` (gated
      `forms.manage.tenant`): edits `label`/`fieldType`/`options`/`isRequired` on a field the caller's
      own `request.tenantDb` can resolve (RLS already scopes this to the caller's own tenant rows —
      global rows are simply unreachable for write, `404`); `displayOrder` re-sequences only among the
      caller's own tenant fields for that form (`422` if it would place the field ahead of/among
      global fields — contracts/custom-fields-api.md). Depends on T014.
- [X] T016 [US1] Create the Server Component route guard
      `apps/web/app/(dashboard-shell)/settings/forms/page.tsx` (mirrors
      `settings/department/page.tsx`). Depends on T002.
- [X] T017 [US1] Build `apps/web/app/(dashboard-shell)/settings/forms/forms-settings-client.tsx`: a
      form-type list (`GET /tenant-api/tenant/form-definitions`), a field-config view per selected type
      (`GET /tenant-api/tenant/form-fields?formKey=`), an "+ Add field" action (gated by
      `forms.manage.tenant`) opening a `Drawer` (`@tm/ui`, right side, matching Department's
      create/edit pattern) with label / auto-suggested-but-editable field key / field-type `<select>`
      / an options editor (dynamic add/remove text list, shown only for select/multiselect) / a
      required `Toggle`; native HTML5 `draggable`/`dragstart`/`dragover`/`drop` reordering among
      tenant-added rows. Depends on T011, T014, T015, T016.
- [X] T018 [US1] Wire per-row Edit (opens the T017 `Drawer` pre-filled) for tenant-added fields, and
      client-side inline duplicate-key checking against the already-fetched field list before submit,
      in `forms-settings-client.tsx`. Depends on T017.

**Checkpoint**: User Story 1 is fully functional and independently testable — a tenant admin can build
out a form type's field set, even before any consuming module (Department) actually renders them.

---

## Phase 4: User Story 2 - A form renders the correct merged fields for everyone filling it out (Priority: P1)

**Goal**: Department's existing (Spec 009) create/edit drawer renders the merged global+tenant field
set after its own system fields, validates required/type on submit, and saves values — giving the
framework one real, demoable consumer (spec Clarification).

**Independent Test**: With a form type that has a global field and a tenant field configured (from US1,
or seeded directly per quickstart.md §2), open Department's create/edit drawer as a user holding only
`department.manage` and confirm both custom fields render, in order, with validation and persistence
working.

### Tests for User Story 2

- [X] T019 [P] [US2] Integration test: rendering (via `GET /tenant/form-fields`) merges system-field
      context + global + tenant fields in `displayOrder` with no duplicates, in
      `apps/api/tests/integration/custom-fields-render-merge-order.test.ts`.
- [X] T020 [P] [US2] Integration test: creating/editing a Department with `customFieldValues` saves
      them, enforces a required custom field's presence, and a value's declared `fieldType` (`422` on
      mismatch), in `apps/api/tests/integration/custom-fields-department-integration.test.ts`.

### Implementation for User Story 2

- [X] T021 [US2] Implement `GET /tenant/custom-field-values?formKey=&entityId=` and
      `PUT /tenant/custom-field-values` in `tenant-form-routes.ts`, using T010's
      `saveCustomFieldValues` for the `PUT` (contracts/custom-fields-api.md). Depends on T010, T011.
- [X] T022 [US2] Extend `POST`/`PATCH /tenant/departments` in
      `apps/api/src/departments/tenant-department-routes.ts` with an optional
      `customFieldValues: Record<string, unknown>` body field — after the department row is
      inserted/updated, call `saveCustomFieldValues(request.tenantDb, "department", departmentId,
      customFieldValues, mergedFields)` (T010) **inside the same request transaction**, not a second
      HTTP call (research.md §5). Depends on T010, T009.
- [X] T023 [US2] Extend
      `apps/web/app/(dashboard-shell)/settings/department/department-settings-client.tsx`'s
      Create/Edit `Drawer`: fetch the merged field list (`GET /tenant-api/tenant/form-fields?
      formKey=department`) and, when editing, existing values (`GET /tenant-api/tenant/
      custom-field-values?formKey=department&entityId=`); render them after the existing system
      fields (Name/Parent/Description/Status/Manager/Assistant Manager); collect entered values into
      `customFieldValues` on submit. Depends on T021, T022.
- [X] T024 [US2] Add client-side required/type validation for the rendered custom fields, mirroring
      the server (T008), in `department-settings-client.tsx`. Depends on T023.

**Checkpoint**: User Stories 1 AND 2 both work independently — the framework is usable and has one
real, end-to-end demoable consumer.

---

## Phase 5: User Story 3 - Global fields stay locked to tenant admins (Priority: P2)

**Goal**: A `forms.manage.tenant` user can see every global field, understands it's a platform default
(visually distinct), and cannot edit/delete/reorder it through any path — UI or direct API call.

**Independent Test**: As a `forms.manage.tenant` user, confirm a global field shows no interactive
affordance in the UI, then attempt a direct `PATCH` against its `fieldId` and confirm it's rejected.

### Tests for User Story 3

- [X] T025 [P] [US3] Integration test: a `forms.manage.tenant` user's `PATCH` attempt against a global
      (`tenantId IS NULL`) field's id is rejected (RLS makes it unreachable for write — `404`, not a
      silent no-op), in `apps/api/tests/integration/custom-fields-global-field-locked.test.ts`.

### Implementation for User Story 3

- [X] T026 [US3] Confirm `PATCH /tenant/form-fields/:fieldId` (T015) already resolves a global field's
      id as "not found" for a tenant caller (RLS-driven) — if the current query path could instead
      return a misleading error, adjust it to return a clear `404` consistently. Depends on T015.
- [X] T027 [US3] Add a visible "Global" `Badge` (`@tm/ui`) and fully non-interactive rendering (no
      edit/drag/archive affordance) for `scope: "global"` rows in `forms-settings-client.tsx`. Depends
      on T017.

**Checkpoint**: All P1/P2-so-far user stories work independently — global fields are provably locked
at both the API and UI layers.

---

## Phase 6: User Story 4 - Archiving a field never loses historical data (Priority: P2)

**Goal**: A `forms.manage.tenant` user can archive a tenant field; it stops appearing on future form
renders, but every previously stored value for it remains intact and unmodified.

**Independent Test**: Add a field, submit a value for it on a real Department, archive the field, and
confirm it no longer renders while the stored value is still present in `custom_field_values`.

### Tests for User Story 4

- [X] T028 [P] [US4] Integration test: archiving a field that has stored `custom_field_values` removes
      it from `getFormFields`'s (T009) result but leaves its values rows unmodified, in
      `apps/api/tests/integration/custom-fields-archive-preserves-values.test.ts`.

### Implementation for User Story 4

- [X] T029 [US4] Extend `PATCH /tenant/form-fields/:fieldId` (T015) to accept `{ archived: true }`,
      setting `archivedAt = now()` — never a hard `DELETE` against `form_fields` (research.md §7;
      there is no separate `DELETE` endpoint — contracts/custom-fields-api.md). Depends on T015.
- [X] T030 [US4] Add a per-row "Archive" action (kebab/menu, mirroring Department's `RowActionsMenu`
      pattern from Spec 009) for tenant-added fields in `forms-settings-client.tsx`. Depends on T017,
      T029.

**Checkpoint**: All P1/P2 user stories work independently — the framework never loses data on field
removal.

---

## Phase 7: User Story 5 - Settings becomes its own top-level sidebar section (Priority: P3)

**Goal**: "Settings" appears as its own top-level sidebar section (peer to "Administration"),
containing Authentication (relocated) and Forms; the existing Authentication Settings URL keeps
working unchanged.

**Independent Test**: Open the sidebar and confirm "Settings" is a top-level entry, not nested under
"Administration," containing both children; visit the existing Authentication Settings URL directly
and confirm it still resolves.

### Implementation for User Story 5

- [X] T031 [US5] Add a new, visually distinct icon (e.g. `sliders` → lucide `SlidersHorizontal`) to the
      icon registry in `packages/ui/src/app-shell.tsx` for the new "Settings" section — deliberately
      not reusing Administration's existing `settings` (gear) icon key, to keep the two sections
      visually distinguishable.
- [X] T032 [US5] In `apps/web/app/(dashboard-shell)/layout.tsx`: add a new top-level `navSections`
      entry (peer to `"administration"`, not nested under it) — an expandable group labeled "Settings"
      with children "Authentication" (existing `/settings/authentication` route, gated on the existing
      `canManageAuth` check) and "Forms" (new `/settings/forms` route, gated on `forms.manage.tenant`);
      remove the Authentication Settings entry from `footerEntries` (no route/URL changes — only its
      nav location moves, so no redirect logic is needed, per plan.md Summary). Depends on T016, T031.

**Checkpoint**: All five user stories are independently functional. The feature is complete against
spec.md.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Documentation hygiene and full end-to-end validation across every story.

- [X] T033 [P] Append this feature's new migrations (T004–T007) to the "Full migration order
      (reference)" table in `apps/api/drizzle/README.md`.
- [X] T034 [P] Re-run the existing `apps/api/tests/integration/rls-cross-tenant.test.ts` and Spec 009's
      Department test suite unchanged, confirming no regression from this feature's schema/route
      additions.
- [X] T035 Run every scenario in `specs/010-custom-fields-framework/quickstart.md` end-to-end
      (including its final "Verifying no functional regression" step against Spec 009's own
      quickstart) and fix any discrepancy found.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **BLOCKS all user stories** — schema, the
  `app.is_super_admin`-based dual-visibility RLS, permissions, and both read-only endpoints are read
  by every story, not just one.
- **User Stories (Phase 3-7)**: All depend on Foundational completion.
  - US1 (P1) has no dependency on US2/US3/US4/US5 and should be built/validated first (MVP).
  - US2 (P1) depends on US1's route file existing (`tenant-form-routes.ts`, T011) to add the values
    endpoints alongside the existing reads, and touches a *different* existing file
    (`tenant-department-routes.ts`) for the actual retrofit — independently testable via its own
    Department-integration scenario once Foundational is in place, even before US1's UI exists (a
    field can be seeded directly per quickstart.md §2).
  - US3 (P2) and US4 (P2) both extend US1's same route file and client component
    (`tenant-form-routes.ts` / `forms-settings-client.tsx`) — independently testable via their own
    lock/archive scenarios once US1 exists.
  - US5 (P3) depends on US1's `/settings/forms` route existing (to link to) but is otherwise a pure
    navigation change, touching entirely different files (`layout.tsx`, `app-shell.tsx`).
- **Polish (Phase 8)**: Depends on every story being complete.

### Within Each User Story

- Tests (T013, T019-T020, T025, T028) are written before their corresponding implementation task and
  should fail until that task lands.
- Route/schema logic before the client UI that calls it.
- Story complete and checkpoint-validated before moving to the next priority.

### Parallel Opportunities

- T002, T003 (Setup) in parallel with T001.
- T006, T007 (Foundational) in parallel with each other and with T004/T005 once those land (different
  concerns, same migration sequence point — coordinate migration numbering, not parallel *files*, so
  treat as sequential in practice despite no code dependency).
- T013 (US1 test) can be written in parallel with T014-T018 (implementation), per the standard
  tests-before-implementation ordering within the story.
- T019, T020 (US2 tests) in parallel with each other.
- US3 (T025-T027) and US4 (T028-T030) can be built in parallel by different contributors once US1
  lands, since their tests are independent (though both extend the same two files, so coordinate
  merge order).
- US5 (T031-T032) can be built in parallel with US2/US3/US4 by a different contributor once US1's
  route exists, since it touches entirely different files.

---

## Parallel Example: Foundational Phase

```bash
# T006 and T007 are both new seed migrations and can be authored in parallel (coordinate final
# migration numbering before applying):
Task: "Seed migration: form_definitions row for 'department'"
Task: "Seed migration: forms.manage.global/forms.manage.tenant permissions + hr_admin grant/backfill"
```

## Parallel Example: User Story 2 Tests

```bash
Task: "Integration test: merge order (system+global+tenant, no dup) in apps/api/tests/integration/custom-fields-render-merge-order.test.ts"
Task: "Integration test: Department end-to-end custom field save/validation in apps/api/tests/integration/custom-fields-department-integration.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational — schema, `app.is_super_admin`-based dual-visibility RLS,
   permissions, shared validation/query library, both read-only endpoints.
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: run quickstart.md §2-§3 (seed a global field directly, then build out
   tenant fields via the UI) independently.
5. Demo: a tenant admin building out a form type's field set — even before Department actually renders
   any of it yet.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. User Story 1 → validate independently → demoable.
3. User Story 2 → validate independently (quickstart.md §5) → demoable (MVP-complete, real consumer).
4. User Story 3 → validate independently (quickstart.md §4) → demoable.
5. User Story 4 → validate independently (quickstart.md §6) → demoable.
6. User Story 5 → validate independently (quickstart.md §7) → demoable.
7. Polish → full quickstart.md pass, no regression in existing RLS/Department suites.

### Parallel Team Strategy

1. One contributor completes Setup + Foundational (schema/RLS/permissions/shared library) — this
   genuinely blocks everyone else.
2. Once Foundational lands:
   - Contributor A: User Story 1 → then User Story 3 → then User Story 4 (same route file/client
     component, natural continuation).
   - Contributor B: User Story 2 (different existing files — Department's own route/client) — only
     needs Foundational, not US1.
   - Contributor C: User Story 5 (different files entirely — `layout.tsx`/`app-shell.tsx`) — only
     needs US1's route to exist.
3. Polish once all stories land.
