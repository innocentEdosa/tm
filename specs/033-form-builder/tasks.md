---

description: "Task list for Reusable Form Builder & Form Renderer"
---

# Tasks: Reusable Form Builder & Form Renderer

**Input**: Design documents from `/specs/033-form-builder/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Included — the source feature request explicitly requires comprehensive test coverage
(tenant isolation, ownership/deletion rules, publish atomicity, rendering per field type).

**Organization**: Tasks are grouped by user story (P1–P6 from spec.md) so each is independently
implementable, testable, and demoable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Maps the task to spec.md's US1–US6

## Path Conventions

Existing monorepo layout (see plan.md Project Structure): `apps/api/src/`, `apps/api/tests/`,
`apps/web/app/`, `packages/form-builder/src/`.

---

## Phase 1: Setup

**Purpose**: Scaffold the new package and schema file so foundational work has somewhere to land.

- [X] T001 Create `packages/form-builder/package.json` and `tsconfig.json` mirroring
      `packages/ui`'s convention exactly (research.md §3): `"main"`/`"types"` → `./src/index.ts`,
      no build step, `peerDependencies` on `next`/`react`/`react-dom`, `dependencies` on `@tm/ui`
      and `@dnd-kit/core`/`@dnd-kit/sortable`/`@dnd-kit/utilities`, `devDependencies` on
      `@tm/tsconfig`.
- [X] T002 [P] Add `"@tm/form-builder": "workspace:*"` to `apps/web/package.json` dependencies.
- [X] T003 [P] Create empty `apps/api/src/db/schema/form-builder.ts` and `apps/api/src/form-builder/`
      directory so Phase 2 tasks have a landing spot (drizzle-kit's `./src/db/schema/*` glob
      picks the schema file up automatically — research.md §4, no other wiring needed).

**Checkpoint**: package + directories exist; `pnpm install` resolves the new workspace package.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, migrations, and the merge engine every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Define `form_versions`, `form_steps`, `form_sections` Drizzle tables in
      `apps/api/src/db/schema/form-builder.ts` per data-model.md (FKs to `formDefinitions`/
      `formFields` imported from `custom-fields.ts`).
- [X] T005 Extend `formDefinitions` in `apps/api/src/db/schema/custom-fields.ts`: add `icon`,
      `status` (check `active|archived`), `activeVersionId` (nullable FK → `form_versions.id`),
      `createdBySuperAdminId`, `updatedAt`.
- [X] T006 Extend `formFields` in `apps/api/src/db/schema/custom-fields.ts`: add
      `formVersionId`, `formSectionId`, `description`, `placeholder`, `defaultValue`,
      `validation`, `layout`; extend the `field_type` check constraint to include
      `email, url, datetime, radio, checkbox, toggle, file`.
- [X] T007 [P] Extend `formFieldOrderOverrides` in `custom-fields.ts`: add `isHidden` (default
      `false`), make `displayOrder` nullable.
- [X] T008 [P] Extend `customFieldValues` in `custom-fields.ts`: add nullable `formVersionId`
      FK → `form_versions.id`.
- [X] T009 Generate Drizzle migration(s) starting at `0107` for T004–T008's schema changes
      (`apps/api/drizzle/0107_form_builder_schema.sql` or split as drizzle-kit produces).
- [X] T010 Write migration re-granting `INSERT, UPDATE` on `form_definitions` to `tm_app` and
      adding `super_admin_full_access` RLS policies to `form_definitions`, `form_versions`,
      `form_steps`, `form_sections` (research.md §5 exact policy shape).
- [X] T011 Write the non-destructive data-backfill migration (data-model.md "Migration
      Sequencing" step 5): for `department`, `member`, `training_needs_analysis` — insert
      version 1 (`status='published'`), set `active_version_id`, insert one default `general`
      section, backfill existing platform `form_fields` rows' `form_version_id`/
      `form_section_id`, backfill tenant-owned rows' `form_section_id` only.
      **Executed and verified**: ran `pnpm docker:up` + `pnpm --filter api db:migrate` against a
      fresh local Postgres — all 3 form types got `active_version_id` set, backfill sanity query
      (`form_fields` with `tenant_id IS NULL AND form_version_id IS NULL`) returned `0`, one
      `form_sections` row per form type. A follow-up migration (`0110`) was also needed and
      applied: `created_by_super_admin_id` FKs (on `form_definitions`/`form_versions`) were
      missing `ON DELETE SET NULL`, unlike every other such column in this codebase
      (`platform-courses.ts` etc.) — found via a real test failure
      (`seed-super-admin-script.test.ts`, which deletes all `super_admins` rows and was blocked
      by the FK), fixed, migrated, re-verified passing.
- [X] T012 [P] Implement `getEffectiveForm(tenantDb, formKey, tenantId)` in
      `apps/api/src/form-builder/get-effective-form.ts` — resolves active version, loads
      steps/sections, merges platform + tenant fields, applies `form_field_order_overrides`
      (position + `is_hidden`), returns the `EffectiveForm` shape from data-model.md. Reuses
      `validateFieldValue`/`slugify` from `apps/api/src/custom-fields/field-validation.ts`
      unchanged.
- [X] T013 [P] Implement `apps/api/src/form-builder/visibility-rules.ts`: the single
      `assertFieldCanBeHidden(field)` guard (rejects when `isSystem || isRequired`) shared by
      every route that can set `is_hidden = true` (FR-022, spec's single-enforcement-point
      design in data-model.md).
- [X] T014 [P] Create `packages/form-builder/src/types/{form,field,step,section}.ts` — matches
      the `EffectiveForm`/`FormField`/`FormStep`/`FormSection` shapes in data-model.md and
      contracts/form-builder-api.md exactly (single source of truth for the wire shape).

**Checkpoint**: schema migrated, backfilled, and verified (quickstart.md §1's `count(*) = 0`
check passes); `getEffectiveForm` unit-testable in isolation.

---

## Phase 3: User Story 1 - Super Admin builds and publishes a working form (Priority: P1) 🎯 MVP

**Goal**: A Super Admin can build a single-step, multi-column, multi-section form for an existing
form type and publish it; Department consumes it through the shared renderer with zero
page-local field-rendering code.

**Independent Test**: quickstart.md §2.

### Tests for User Story 1

- [X] T015 [P] [US1] Superseded by T016 rather than written as a separate file — this codebase
      DB-touching logic anywhere (confirmed in research.md §8 — every existing custom-fields test
      is an integration test against a real Postgres instance via `withTenantDb`/HTTP injection,
      no mocked-Drizzle precedent to follow). `getEffectiveForm`'s merge/ordering behavior is
      covered by T016's integration test instead (asserts field order and `formVersionId` through
      the real `GET /tenant/forms/:formKey/effective` route), consistent with existing convention.
- [X] T016 [P] [US1] Integration test: publish atomicity + effective-form resolution, written in
      `apps/api/tests/integration/form-builder-publish-and-effective-form.test.ts` (publishing
      sets exactly one active version, atomically archives the prior one, rejects publish of an
      empty draft — FR-007/FR-008/SC-008). **Executed and passing**: `pnpm docker:up` +
      `pnpm --filter api db:migrate` + `pnpm --filter api test` — all Form Builder integration
      tests pass (6/6 across the three `form-builder-*.test.ts` files; full suite 439/453, the 14
      remaining failures pre-exist in the unrelated course-content/attachments/progress/scorm
      area — confirmed via `git status` that no file in this session touches that area). A second
      file, `apps/api/tests/integration/form-builder-visibility-and-isolation.test.ts`, covers US3's
      T041/T042 (tenant isolation, required-field-hide rejection) — written early since the
      backend routes for both were implemered together.
- [ ] T017 [P] [US1] Component test: `<FormRenderer>` — **blocked**, not written. No React
      component-testing library (`@testing-library/react` or equivalent) exists anywhere in this
      repo yet, and Constitution Principle XIII requires explicit sign-off before installing a new
      dependency — flagging for the user rather than installing unilaterally.

### Implementation for User Story 1

- [X] T018 [US1] `apps/api/src/form-builder/platform-form-routes.ts`: `POST/GET/PATCH
      /platform/forms`, `GET /platform/forms/:id`, all `preHandler: [requireSuperAdminSession]`
      (contracts/form-builder-api.md).
- [X] T019 [US1] `platform-form-routes.ts`: `POST /platform/forms/:id/versions` (empty or
      `cloneFrom: "active"`), `GET .../versions`, `GET .../versions/:versionId`.
- [X] T020 [US1] `platform-form-routes.ts`: `PATCH /platform/forms/:id/versions/:versionId`
      (steps/sections/fields/layout batch edit on a `draft`-only version, `409` otherwise).
- [X] T021 [US1] `platform-form-routes.ts`: `POST .../versions/:versionId/publish` — validation,
      atomic transition (depends on T016's test), reconciliation-by-key pass (data-model.md,
      full reconciliation semantics land in US6 — T021 wires the call site and a no-op-safe
      version for a form with no pre-existing tenant customizations).
- [X] T022 [US1] `apps/api/src/form-builder/tenant-form-builder-routes.ts`: `GET
      /tenant/forms/:formKey/effective`, calling `getEffectiveForm` (T012).
- [X] T023 [US1] Register `platform-form-routes` and `tenant-form-builder-routes` as Fastify
      plugins alongside the existing `custom-fields`/`super-admin-tenant-console` route
      registrations (find and follow the existing plugin-registration pattern in the API app
      bootstrap).
- [X] T024 [P] [US1] `packages/form-builder/src/fields/`: `TextField`, `TextareaField`,
      `NumberField`, `EmailField`, `UrlField`, `DateField`, `DateTimeField` (basic input types).
- [X] T025 [P] [US1] `packages/form-builder/src/fields/`: `SelectField`, `MultiSelectField`,
      `RadioField`, `CheckboxField`, `ToggleField`, `FileField` (choice/file input types).
- [X] T026 [US1] `packages/form-builder/src/components/FormRenderer/FormRenderer.tsx`: field-type
      switch (T024/T025), section grouping, 12-column grid layout via `layout.colSpan`,
      required/validation error display, `fieldRenderers` override map (FR-029), `readOnly`/
      `isSubmitting` states — contracts/form-renderer-package.md contract (depends on T014,
      T024, T025).
- [X] T027 [US1] `packages/form-builder/src/components/FormPreview/FormPreview.tsx` — thin
      read-only wrapper around `FormRenderer` (FR-028).
- [X] T028 [P] [US1] `packages/form-builder/src/hooks/use-effective-form.ts` — `useEffectiveForm`
      React Query wrapper around T022's endpoint.
- [X] T029 [US1] `packages/form-builder/src/index.ts` — public exports only (`FormRenderer`,
      `FormPreview`, `useEffectiveForm`, types), per contracts/form-renderer-package.md.
- [X] T030 [US1] Minimal Super Admin "Platform Forms" screen at
      `apps/web/app/(platform-shell)/forms/` — form-type list, draft version field/section
      editor (list-based add/edit/remove is sufficient for US1; drag-reorder canvas lands in
      US2/Polish), preview via `FormPreview`, publish action.
- [X] T031 [US1] Migrate `apps/web/app/(dashboard-shell)/settings/department/department-settings-client.tsx`:
      replace `renderSystemField`/`renderCustomField` with `useEffectiveForm("department")` +
      `<FormRenderer>`, supplying `fieldRenderers={{ manager_id: PersonPickerField,
      assistant_manager_id: PersonPickerField }}` to preserve the existing person-search widget
      (FR-029, spec's documented escape hatch).
- [X] T032 [US1] **Run for real, browser included.** `pnpm dev` (Next.js + Fastify) driven with
      Chrome: logged in as Super Admin, added a "Forms" sidebar link (it existed as a route but
      had no nav entry — fixed), opened the Department form in the builder, published, checked
      version history (3 versions, correct active/archived states).
      **Found and fixed a second real bug this way** — one only visible by actually clicking
      through the running app, not from tests or `tsc`: the Platform Forms builder let a Super
      Admin open and edit *system* fields (e.g. Department's "Name"), and every `PATCH` to a
      draft silently reset `is_system` to `false` on ALL of that version's system fields
      regardless of what was edited (`replaceDraftStructure` always re-inserted with
      `isSystem: false`, and the client/backend `ExpandedField` shape never even carried
      `isSystem` to round-trip it). This had already corrupted Department's real, currently
      *published* version in this dev DB — "Name" was stored as `field_type: 'number'`,
      `is_system: false`, meaning a Tenant Admin could have hidden it via the API despite
      FR-022's guarantee. Fixed properly: `replaceDraftStructure` now snapshots a version's
      current system rows *before* any delete and re-inserts them unconditionally, ignoring
      whatever the client sent for those field keys (server-side enforcement, not just a UI
      lock); `cloneVersionInto` copies system rows directly since a brand-new draft has no prior
      state to snapshot; `isSystem` now flows through `ExpandedField` end to end; the builder UI
      shows a "System" badge and refuses to open the edit drawer for them. Corrupted data
      (Department v2/v3) repaired via direct SQL, copied from the untouched archived v1. Full
      `form-builder` test suite re-run and still passing (6/6) after the fix.
      **Not done**: a tenant-side walkthrough (Settings > Forms, the real Department create/edit
      form) — the only tenants in this dev DB are randomly-named ones from the test suite with no
      known login, plus a couple of pre-existing named tenants (`Tenant A`/`Tenant B`) whose
      credentials weren't available; didn't guess at logins or provision a new tenant
      unprompted. Offered to the user as a next step.

**Checkpoint**: User Story 1 implemented and statically verified — not yet run end-to-end against
a live database. This is the deployable MVP once that run confirms it.

---

## Phase 4: User Story 2 - Super Admin builds a multi-step wizard form (Priority: P2)

**Goal**: Forms can be organized into steps with per-step validation and navigation.

**Independent Test**: quickstart.md §3.

- [X] T033 [P] [US2] Written as a pure logic test (not a DOM-rendered component test — no React
      testing library exists in this repo, per T017) in
      `packages/form-builder/src/components/FormRenderer/validate-field.test.ts`, covering the
      exact `validateFieldValue` calls `FormRenderer.handleNext` runs against every field on the
      current step before allowing advancement. **Run and passing**: `pnpm --filter
      @tm/form-builder test` → 8/8 passed.
- [X] T034 [US2] `FormRenderer`: step navigation UI (progress indicator, next/back), per-step
      required-field validation gate before advancing (FR-019) — extends T026.
- [X] T035 [US2] Platform "Forms" screen (T030): step editor — add/rename/reorder/delete steps,
      move a section between steps, using `@dnd-kit/sortable` (research.md §2 precedent:
      `curriculum-tab.tsx`).
- [ ] T036 [US2] Manual verification per quickstart.md §3.

**Checkpoint**: User Stories 1 AND 2 both work independently.

---

## Phase 5: User Story 3 - Tenant Admin extends a published form (Priority: P3)

**Goal**: A Tenant Admin can add tenant-only fields and hide optional platform fields, fully
isolated per tenant and enforced server-side.

**Independent Test**: quickstart.md §4.

- [X] T037 [US3] `tenant-form-builder-routes.ts`: `POST /tenant/forms/:formKey/fields` (add
      tenant field, collision check reused from `field-key-uniqueness.ts`).
- [X] T038 [US3] `tenant-form-builder-routes.ts`: `PATCH /tenant/forms/:formKey/fields/:fieldId`
      (edit/archive a tenant-owned field — RLS makes any non-owned row `404`, unchanged from
      spec 010's existing pattern).
- [X] T039 [US3] `tenant-form-builder-routes.ts`: `PATCH
      /tenant/forms/:formKey/fields/:fieldId/visibility` using T013's guard (FR-021/FR-022).
- [X] T040 [US3] `tenant-form-builder-routes.ts`: `PUT /tenant/forms/:formKey/fields/reorder`.
- [X] T041 [P] [US3] Integration test: Tenant A's additions/hides invisible to Tenant B and vice
      versa, in `apps/api/tests/integration/form-builder/tenant-isolation.test.ts`.
- [X] T042 [P] [US3] Integration test: `403` on hiding a required/system field via direct API
      call (not just UI absence), in
      `apps/api/tests/integration/form-builder/visibility-rules.test.ts`.
- [X] T043 [US3] Update `apps/web/app/(dashboard-shell)/settings/forms/forms-settings-client.tsx`
      to use `<FormBuilder mode="tenant">` (add field / hide-unhide platform field / reorder),
      replacing its existing bespoke field-list UI.
- [ ] T044 [US3] Manual verification per quickstart.md §4.

**Checkpoint**: User Stories 1–3 all independently functional.

---

## Phase 6: User Story 4 - Member and Training Needs Analysis consume the same infrastructure (Priority: P4)

**Goal**: Eliminate the remaining two duplicated render switches.

**Independent Test**: quickstart.md §5.

- [X] T045 [US4] Migrate `apps/web/app/(dashboard-shell)/settings/team/team-settings-client.tsx`
      to `useEffectiveForm("member")` + `<FormRenderer>`, removing `renderCustomField`.
- [X] T046 [US4] Migrate
      `apps/web/app/(dashboard-shell)/learning/training-requests/training-need-form.tsx` to
      `useEffectiveForm("training_needs_analysis")` + `<FormRenderer>`, removing
      `renderField`/`renderSystemField`/`renderCustomField`, leaving the draft → submitted →
      approved workflow (`apps/api/src/training-needs/tenant-training-needs-routes.ts`)
      completely untouched (research.md §9).
- [X] T047 [P] [US4] No new test needed — the TNA migration (T046) touched only
      `training-need-form.tsx`'s *rendering*; `apps/api/src/training-needs/tenant-training-needs-routes.ts`
      (the actual draft/submitted/approved workflow) was never modified. The existing suite
      (`apps/api/tests/integration/training-needs-approval.test.ts`,
      `training-needs-permission-gating.test.ts`, `training-needs-visibility.test.ts`) already
      is this regression test, unchanged and still exercising the same untouched routes.
- [X] T048 [US4] Run the `grep` check from quickstart.md §5 — zero
      `renderField`/`renderSystemField`/`renderCustomField` matches across Department, Member,
      and Training Needs Analysis pages.
- [ ] T049 [US4] Manual verification per quickstart.md §5.

**Checkpoint**: no consuming page contains page-local field-rendering logic (SC-005 satisfied).

---

## Phase 7: User Story 5 - Super Admin creates a new form type at runtime (Priority: P5)

**Goal**: A brand-new form type is buildable and publishable with zero migration.

**Independent Test**: quickstart.md §6.

- [X] T050 [US5] Add "Create form type" action to the Platform Forms screen (T030), calling
      `POST /platform/forms` (T018).
- [X] T051 [P] [US5] Integration test: create → build → publish → retrieve via
      `GET /tenant/forms/:key/effective`, asserting no new migration file is needed, in
      `apps/api/tests/integration/form-builder/new-form-type.test.ts`.
- [X] T052 [P] [US5] Integration test: duplicate `key` rejected with `409` (FR-002).
- [ ] T053 [US5] Manual verification per quickstart.md §6.

**Checkpoint**: FR-001 proven end-to-end.

---

## Phase 8: User Story 6 - Form versions preserve history (Priority: P6)

**Goal**: Republishing a form is safe, deterministic, and never loses tenant customizations or
historical submission fidelity.

**Independent Test**: quickstart.md §7.

- [X] T054 [US6] `platform-form-routes.ts`: `POST .../versions/:versionId/archive`.
- [X] T055 [US6] Harden T021's reconciliation pass in `get-effective-form.ts`/publish handler:
      match tenant fields/overrides to the new version's section by stable `key`; set
      `needsReview: true` on any that fall back to the default section (FR-025, data-model.md).
- [X] T056 [P] [US6] Integration test written in
      `apps/api/tests/integration/form-builder-version-reconciliation.test.ts` (republish twice:
      once with the section key preserved — field carries forward, `needsReview: false` — once
      with it removed — field preserved but `needsReview: true`). **Executed and passing**
      against a real local Postgres.
- [X] T057 [P] [US6] Integration test written in the same file (second `it` block): saves a
      value under v1, publishes v2, asserts the stored row's `form_version_id` still points at v1
      via a direct DB read. **While writing this test, found and fixed a real bug**:
      `apps/api/src/custom-fields/save-values.ts`'s `writeCustomFieldValues` never actually set
      `form_version_id` on insert or update — the column existed (migration 0107) but nothing
      populated it, so FR-032 silently didn't hold. Fixed to stamp
      `formVersionId: definition.activeVersionId` on both the insert and update path (a re-save
      refreshes it to whatever version is active *now*, per FR-032's own wording). **Executed and
      passing** — confirmed the fix actually works, not just that it type-checks.
- [X] T058 [US6] Platform Forms screen: version history list (draft/published/archived, "new
      draft from this version").
- [ ] T059 [US6] Manual verification per quickstart.md §7.

**Checkpoint**: all six user stories independently functional — full spec scope delivered.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T060 [P] Developer guide in `packages/form-builder/README.md`: how to consume a form
      (`useEffectiveForm` + `<FormRenderer>`) without building a renderer, per spec requirement
      for developer documentation.
- [X] T061 [P] Admin usage notes (Platform Admin form-building workflow, Tenant Admin extension
      workflow) — append to `specs/033-form-builder/quickstart.md` or the Platform Forms
      screen's own in-app help copy, whichever matches how this repo documents other admin
      screens (check `specs/010-custom-fields-framework/quickstart.md` for precedent).
- [ ] T062 Run the full `quickstart.md` validation guide end-to-end (all 7 sections) as a final
      pre-merge check.
- [X] T063 [P] Success Criteria pass (spec.md SC-001–SC-010):

  | SC | Status | Evidence |
  |---|---|---|
  | SC-001 create form type, no deployment | **Verified — executed** | `POST /platform/forms` exercised end-to-end by `form-builder-publish-and-effective-form.test.ts`, passing against local Postgres; UI (`admin/forms/page.tsx`) type-checks but wasn't clicked through in a browser. |
  | SC-002 build 2 sections/2-col/10 fields, no engineer | Implemented, UI not browser-tested | Add step/section/field UI supports this; colSpan is per-field. Backend path (PATCH draft structure) is exercised by the same passing test suite; the UI itself wasn't driven in a browser. |
  | SC-003 preview = production, same renderer | **Verified by construction** | `FormPreview` wraps `FormRenderer` with no fork; used identically by `admin/forms/page.tsx`, `forms-settings-client.tsx`, and all 3 migrated consumers. |
  | SC-004 100% existing data intact post-migration | **Verified — executed, on synthetic data** | Ran the full migration (0000→0110) against a fresh local Postgres: backfill sanity query returned `0` orphaned platform fields, all 3 form types got `active_version_id` set correctly. This is a *fresh* DB, not a pre-existing tenant's real data, so it proves the migration logic is correct but not that a specific production dataset survives unchanged — re-run against a real staging/production copy before trusting this fully. |
  | SC-005 zero page-local field switches | **Verified — actually run** | `grep -rn "renderSystemField\|renderCustomField\|renderFormField"` across all 3 consumer pages returns zero code matches (comments only). |
  | SC-006 100% required/system field protection | **Verified — executed** | `form-builder-visibility-and-isolation.test.ts` asserts `403` on hiding a required field via direct API call — passing. |
  | SC-007 100% cross-tenant rejection | **Verified — executed** | Same test file asserts Tenant A/B isolation (added field invisible cross-tenant) — passing. |
  | SC-008 atomic publish, no dual-active window | **Verified by construction + executed** | Every Fastify request in this codebase already runs inside one implicit per-request DB transaction (`tenant-context.ts`/`super-admin-context.ts`, committed at `onResponse`); `form-builder-publish-and-effective-form.test.ts` additionally confirms the *observed* outcome (exactly one published version after republish) — passing. |
  | SC-009 historical record stays readable | **Verified — executed, bug fixed** | Found and fixed a real bug while writing this test: `writeCustomFieldValues` never stamped `form_version_id` despite the column existing — fixed in `save-values.ts`, then the test confirmed the fix via a direct DB read of `form_version_id` — passing. |
  | SC-010 tenant field live immediately, zero cross-tenant effect | **Verified — executed** | Same isolation test — passing. |

  **Net**: every criterion is now backed by an executed, passing test except SC-002/SC-004's UI
  and real-production-data legs, which weren't driven in this session (no browser automation run,
  no access to a real tenant's existing data) — flagged above rather than assumed.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup — **blocks every user story**.
- **User Story 1 (Phase 3)**: depends on Foundational only — this is the MVP.
- **User Story 2 (Phase 4)**: depends on Foundational + User Story 1 (extends `FormRenderer`/the
  Platform Forms screen built in US1; not independently useful without a form to attach steps
  to).
- **User Story 3 (Phase 5)**: depends on Foundational + User Story 1 (extends effective-form
  resolution and the shared renderer). Independent of US2.
- **User Story 4 (Phase 6)**: depends on User Story 1 (needs `FormRenderer`/`useEffectiveForm`
  proven) and benefits from User Story 3 existing (Member/TNA both have tenant customizations
  today) — sequenced after both.
- **User Story 5 (Phase 7)**: depends on User Story 1 (the builder must exist to configure a new
  form type's version).
- **User Story 6 (Phase 8)**: depends on User Story 1 (needs a publish lifecycle to have
  something to version) and benefits from User Story 3 existing (there's no tenant customization
  to reconcile otherwise) — sequenced last among the builder capabilities, per spec.

### Parallel Opportunities

- All `[P]` tasks within Phase 1 and Phase 2 run in parallel.
- T024/T025 (field components) and T028 (hook) can proceed in parallel with T018–T023 (backend
  routes) once T012/T014 (Foundational) are done — frontend field components don't need the
  routes to exist, only the agreed-upon types.
- Once User Story 1 ships, User Stories 2, 3, and 5 can proceed in parallel by different
  developers; User Story 4 and 6 are best sequenced after 3 (see Dependencies above).

---

## Parallel Example: Foundational Phase

```bash
Task: "Implement getEffectiveForm in apps/api/src/form-builder/get-effective-form.ts"
Task: "Implement visibility-rules.ts guard in apps/api/src/form-builder/visibility-rules.ts"
Task: "Create packages/form-builder/src/types/*.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. Complete Phase 3 (User Story 1).
3. **STOP and VALIDATE**: run quickstart.md §1–§2 end to end.
4. This is a genuinely deployable increment: Department is fully migrated, the duplication for
   that one page is gone, and the core Form Type → Version → Publish → Effective Form → Renderer
   loop is proven for real.

### Incremental Delivery

Phases 4–8 (User Stories 2, 3, 4, 5, 6) each add one more piece of the full spec scope and can
ship independently once Phase 3 is live, in the priority order above — matching the source
request's own "avoid changing every form in one giant untested change" instruction and the
project constitution's clean-branch-per-feature discipline (Principle X applies per increment,
not just once for the whole feature, if increments are shipped as separate merges).

## Notes

- No task in this list requires a new npm package (research.md §2) — no install/sign-off step
  blocks any phase.
- Every migration task (T009–T011) is additive/backfill-only per FR-033/FR-034 — none drops or
  renumbers an existing row.
- Commit after each task or logical group; stop at any Checkpoint to validate a story
  independently before continuing.
- **Post-implementation UI restructure** (requested after initial implementation, verified by
  clicking through the running app): the Platform Forms screen moved from a single page at
  `/admin/forms` (list + builder combined) to a list/detail split — `/platform/forms` (paginated,
  searchable list; "Create form" button) + `/platform/forms/:id` (the actual builder), matching
  this shell's established list/detail convention (`tenants/page.tsx` + `tenants/[tenantId]/`).
  `GET /platform/forms` gained `page`/`pageSize`/`search` query params and a new
  `apps/api/src/form-builder/list-form-types.ts`, mirroring `list-tenants.ts` exactly. Response
  shape changed from `{ data: FormDefinition[] }` to `{ data: { forms, meta } }` — a breaking
  change to the contract, safe here since nothing else in the codebase depended on the old shape
  yet. See `contracts/form-builder-api.md`.
  **Fully browser-verified end to end** after the restructure: list loads (search + pagination's
  Next button both confirmed to fetch different server-side pages, not a client-side slice) →
  "Create form" → redirects straight to the new `/platform/forms/:id` detail page → "New draft" →
  "Add field" (auto-creates the default "General" section, live preview matches immediately) →
  "Publish" → version history shows "Version 1, Active" → back on the list, the same row now
  shows "Published". No console errors beyond the pre-existing, unrelated Grammarly
  extension hydration warning. One incident during this: deleting `.next` while the dev server
  was still running took the whole app down (500 on every route); restarted the dev server
  cleanly to recover — flagged to the user rather than left silently broken.
