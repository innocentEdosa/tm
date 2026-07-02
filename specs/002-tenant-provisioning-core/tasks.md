---

description: "Task list for implementing the Tenant Provisioning Core feature"
---

# Tasks: Tenant Provisioning Core

**Input**: Design documents from `/specs/002-tenant-provisioning-core/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md,
contracts/ (`provision-tenant-api.md`, `seed-default-departments-interface.md`), quickstart.md

**Tests**: Included — the spec requires proof of atomicity (FR-013, SC-005) and zero cross-tenant
visibility (SC-003), and the constitution (Principle I) requires isolation to be proven at the data
layer, not assumed. Test tasks are not optional in this feature, matching Spec 1's precedent.

**Dependency sign-off status**: None needed — this feature adds no new package (research.md §8,
plan.md Technical Context). No task in this list should run `pnpm add`.

**A note on story coupling**: FR-013 requires the whole provisioning attempt to be one atomic,
all-or-nothing transaction (research.md §3), so User Stories 1–3 converge on a single function
(`provisionTenant`) and a single endpoint (`POST /provisioning/tenants`) rather than being separately
deployable the way Spec 1's stories were. Each phase below still adds a distinct, separately-testable
*slice* of that function's behavior, built up incrementally task-by-task — "independent test" for a
story means "a test whose assertions target that story's concern," not "runnable without any other
story's code."

## Format: `[ID] [P?] [Story?] Description with file path (Backend-only | Frontend — needs UI-UX-Pro-Max skill)`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Maps the task to its user story (US1, US2, US3); Setup/Foundational/Polish tasks carry
  no story label

---

## Phase 1: Setup

- [X] T001 Confirm no new dependencies are required for this feature (research.md §8) and that
  `apps/api/drizzle.config.ts`'s existing schema glob (`src/db/schema/*`) picks up this feature's new
  schema files with no config change — a documentation/gate check, not a code change. (Backend-only)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema → RLS → grants → the provisioning transaction envelope, shared by every user
story. **Nothing in Phase 3+ can start until this phase (through T012) is complete.**

- [X] T002 [P] Define `tenants` table schema in `apps/api/src/db/schema/tenants.ts` (`id`, `name`,
  `subdomain` unique not null, `industry` nullable, `primary_contact_name`/`email`/`phone`, `status`
  text not null default `'trial'` with a `CHECK (status IN ('trial','active','suspended','cancelled'))`,
  `created_at`/`updated_at`) per data-model.md `tenants`. (Backend-only)
- [X] T003 [P] Define `department_templates` and `departments` table schemas in
  `apps/api/src/db/schema/departments.ts` (`department_templates`: `id`, `key` unique, `name`,
  `created_at`; `departments`: `id`, `tenant_id` not null FK → `tenants.id`, `name`,
  `source_template_id` nullable FK → `department_templates.id` `ON DELETE SET NULL`,
  `created_at`/`updated_at`, unique `(tenant_id, name)`) per data-model.md `department_templates` /
  `departments`. (Backend-only)
- [X] T004 [P] Define `users` table schema in `apps/api/src/db/schema/users.ts` (`id`, `tenant_id` not
  null FK → `tenants.id`, `full_name`, `email`, `created_at`/`updated_at`, unique
  `(tenant_id, email)`) per data-model.md `users`. (Backend-only)
- [X] T005 Generate the Drizzle migration from T002–T004 via `drizzle-kit generate`, producing
  `apps/api/drizzle/0009_init_tenant_provisioning.sql`. Depends on T002, T003, T004. (Backend-only)
- [X] T006 [P] Author `apps/api/drizzle/0010_rls_tenants.sql`: `ENABLE`/`FORCE ROW LEVEL SECURITY` on
  `tenants`, policy `USING (id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (same)` per
  data-model.md `tenants` Isolation. Depends on T005. (Backend-only)
- [X] T007 [P] Author `apps/api/drizzle/0011_rls_departments.sql`: `ENABLE`/`FORCE ROW LEVEL SECURITY`
  on `departments`, policy `USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH
  CHECK (same)`. Depends on T005. (Backend-only)
- [X] T008 [P] Author `apps/api/drizzle/0012_rls_users.sql`: `ENABLE`/`FORCE ROW LEVEL SECURITY` on
  `users`, same policy shape as T007. Depends on T005. (Backend-only)
- [X] T009 [P] Author `apps/api/drizzle/0013_lock_department_catalog_grants.sql`: `GRANT SELECT` on
  `department_templates` to `tm_app`, `REVOKE INSERT, UPDATE, DELETE` (platform-global, migration-only
  catalog, mirrors Spec 1's `0001_lock_catalog_grants.sql`); `GRANT SELECT, INSERT, UPDATE, DELETE` on
  `tenants`, `departments`, `users` to `tm_app` (RLS enforces per-row scoping, not table grants).
  Depends on T005. (Backend-only)
- [X] T010 [P] **Reverted during implementation.** `apps/api/drizzle/0014_add_user_roles_users_fk.sql`
  was authored to add a FK from `user_roles.user_id` to `users.id`, then rewritten as a documented
  no-op: `users.tenant_id` is `NOT NULL`, but Spec 1's platform Super Admin role assignment
  (`roles.tenant_id IS NULL`) has no tenant to attach a `users` row to, so the FK would have blocked
  Super Admin role assignment entirely (data-model.md `user_roles`, research.md §6). Depends on T005.
  (Backend-only)
- [X] T011 [P] Implement the provisioning transaction envelope, `provisionTenant(pool, input)`, in
  `apps/api/src/provisioning/provision-tenant.ts`: acquire a dedicated client via `pool.connect()`,
  `BEGIN`, generate `tenantId` via `randomUUID()`, run `SELECT set_config('app.tenant_id', $1, true)`,
  wrap all subsequent logic in try/catch with `COMMIT` on success and `ROLLBACK` + client release on
  any thrown error (research.md §1, §3). This task only wires the transaction envelope — later story
  phases add the actual insert steps inside it. Depends on T005. (Backend-only)
- [X] T012 [P] Write `apps/api/tests/integration/tenant-departments-users-rls-cross-tenant.test.ts`
  (Vitest): using raw SQL/test helpers directly (not `provisionTenant`, to prove RLS in isolation from
  application code, mirroring Spec 1's `rls-cross-tenant.test.ts`), seed two test tenants with their
  own `departments`/`users` rows; open a transaction for tenant A (`SET LOCAL app.tenant_id`) and
  assert zero rows are visible/writable for tenant B's rows in `tenants`, `departments`, and `users`,
  and that a transaction with `app.tenant_id` unset sees zero rows in any of the three. Depends on
  T006, T007, T008, T009. (Backend-only)

**Checkpoint**: Schema, RLS, grants, and the transaction envelope all exist and are proven — by
T012 — to isolate tenants correctly (the `user_roles`->`users` FK was attempted and reverted, T010).
User story phases can now begin.

---

## Phase 3: User Story 1 - Capture Company Details & Create the Tenant Record (Priority: P1) 🎯 MVP slice

**Goal**: A submitted company-details payload creates a `tenants` row with a unique `tenant_id` and
Trial status; a duplicate subdomain is rejected.

**Independent Test**: Call `provisionTenant` with a valid payload and confirm the returned `tenant`
has status `"trial"` and the submitted fields; call it again with the same `subdomain` and confirm
rejection with no second row created.

- [X] T013 [US1] Implement the tenant-insert step inside `provisionTenant`
  (`apps/api/src/provisioning/provision-tenant.ts`): insert the `tenants` row using the generated id
  and the submitted company/primary-contact fields, relying on the `status` column default for Trial
  (FR-004); catch a `23505` unique-violation on `subdomain` and throw a typed `SubdomainTakenError`
  instead of the raw pg error (FR-002). Depends on T011. (Backend-only)
- [X] T014 [P] [US1] Write `apps/api/tests/integration/provision-tenant-record.test.ts`: calling
  `provisionTenant` with a valid full payload creates a `tenants` row with status `'trial'` and the
  submitted company/contact fields; calling it again with the same `subdomain` throws
  `SubdomainTakenError` and leaves no second row (FR-001–FR-004, spec Edge Cases). Depends on T013.
  (Backend-only)

**Checkpoint**: Tenant-record creation, Trial default, and subdomain-conflict handling are proven.

---

## Phase 4: User Story 2 - Create the Initial Admin User & Assign Their Role (Priority: P1)

**Goal**: The admin's account is created scoped to the new tenant and holds exactly the HR Admin role;
provisioning fails closed if the required role template is missing; the flow is reachable over HTTP,
gated to Super Admin.

**Independent Test**: A successful call creates a `users` row and a matching `user_roles` row whose
effective permissions equal exactly the HR Admin template's permission set.

- [X] T015 [US2] Extend `provisionTenant` (`apps/api/src/provisioning/provision-tenant.ts`) to: check
  that a `role_templates` row with `key = 'hr_admin'` exists (throw a typed
  `MissingAdminRoleTemplateError` if not, before any other write — FR-014); insert the `users` row
  (admin) scoped to the generated tenant id (FR-008, FR-009); call
  `seedDefaultRolesForTenant(tenantDb, tenantId)` (reused unchanged from
  `apps/api/src/permissions/seed-default-roles.ts`, per Spec 1's
  `contracts/seed-default-roles-interface.md`); look up the tenant's new role whose
  `source_template_id` matches the `hr_admin` template; insert one `user_roles` row linking the admin
  to it (FR-010, FR-011 — exactly one admin, exactly one role). Depends on T013. (Backend-only)
- [X] T016 [P] Author `apps/api/drizzle/0015_seed_provision_tenant_permission.sql`: insert the
  `provision_tenant` permission (category `platform`); insert a `role_template_permissions` row
  granting it to the `super_admin` template (for future reseeds); insert a `role_permissions` row
  granting it directly to the existing live platform Super Admin `roles` row (`tenant_id IS NULL`)
  per research.md §7. Only touches Spec 1's existing tables — no dependency on this feature's new
  tables. (Backend-only)
- [X] T017 [US2] Implement `POST /provisioning/tenants` in
  `apps/api/src/provisioning/provisioning-routes.ts` per `contracts/provision-tenant-api.md`: validate
  required fields (`400` on missing), call `provisionTenant`, map `SubdomainTakenError` → `409`,
  `MissingAdminRoleTemplateError` → `500`, success → `201` with the documented response shape; guard
  with `requirePlatformPermission("provision_tenant")`. Depends on T015, T016. (Backend-only)
- [X] T018 Register `provisioning-routes` in `apps/api/src/server.ts`. Depends on T017. (Backend-only)
- [X] T019 [P] [US2] Write `apps/api/tests/integration/provision-tenant-admin-role.test.ts`: a
  successful `POST /provisioning/tenants` call creates a `users` row scoped to the new tenant and a
  `user_roles` row linking it to the tenant's `hr_admin`-sourced role, with effective permissions
  matching exactly the HR Admin template (FR-008–FR-010, SC-006). Depends on T018. (Backend-only)
- [X] T020 [P] [US2] Write `apps/api/tests/integration/provision-tenant-missing-role-template.test.ts`:
  in a disposable-schema test, delete the `hr_admin` row from `role_templates`, call the route, and
  assert `500` with no `tenants`, `departments`, `users`, or `user_roles` row left behind from the
  attempt (FR-013, FR-014, SC-005). Depends on T018. (Backend-only)
- [X] T021 [P] [US2] Write `apps/api/tests/integration/provision-tenant-forbidden.test.ts`: calling
  `POST /provisioning/tenants` as an authenticated non-Super-Admin user, and as an unauthenticated
  caller, both return `403` and create no rows (research.md §7). Depends on T018. (Backend-only)

**Checkpoint**: Tenant + admin + role assignment is atomic and reachable over HTTP. Departments are
not yet seeded at this checkpoint (FR-006 lands in US3 next) — do not treat this checkpoint alone as
spec-complete.

---

## Phase 5: User Story 3 - Apply and Customize Department Structure During Setup (Priority: P2)

**Goal**: Default department templates are seeded automatically; the admin can submit a customized
final list (rename/add/remove) in the same request instead.

**Independent Test**: A call with `departments` omitted creates exactly the default templates; a call
with an explicit list creates exactly that list; a call with a duplicate name in that list is rejected
and rolls back the whole attempt.

- [X] T022 [US3] Author `apps/api/drizzle/0016_seed_department_templates.sql`: seed
  `department_templates` — `hr` (Human Resources), `sales` (Sales), `engineering` (Engineering),
  `finance` (Finance), `operations` (Operations), `customer_support` (Customer Support) — per
  research.md §5. (Backend-only)
- [X] T023 [US3] Implement `seedDefaultDepartmentsForTenant(tenantDb, tenantId)` in
  `apps/api/src/provisioning/seed-default-departments.ts` per
  `contracts/seed-default-departments-interface.md`: reads every `department_templates` row, inserts
  one `departments` row per template scoped to `tenantId` with `source_template_id` set. Depends on
  T022. (Backend-only)
- [X] T024 [US3] Extend `provisionTenant` (`apps/api/src/provisioning/provision-tenant.ts`) to seed
  departments: if the request's `departments` field is omitted, call
  `seedDefaultDepartmentsForTenant` (FR-006); if provided, insert exactly the submitted `{ name }`
  list instead, catching a `23505` unique-violation on `(tenant_id, name)` as a typed
  `DuplicateDepartmentNameError` (FR-007). Depends on T023, T015. (Backend-only)
- [X] T025 Extend `POST /provisioning/tenants`
  (`apps/api/src/provisioning/provisioning-routes.ts`) to accept the optional `departments` field, map
  `DuplicateDepartmentNameError` → `409`, and include `departments` in the `201` response per
  `contracts/provision-tenant-api.md`. Depends on T024, T017. (Backend-only)
- [X] T026 [P] [US3] Write `apps/api/tests/integration/provision-tenant-default-departments.test.ts`:
  a call with `departments` omitted creates exactly the six default departments, each with the
  corresponding `source_template_id` set (FR-006). Depends on T025. (Backend-only)
- [X] T027 [P] [US3] Write `apps/api/tests/integration/provision-tenant-custom-departments.test.ts`: a
  call with an explicit `departments` list (a rename, an addition, and a removal relative to the
  defaults) creates exactly that list, `source_template_id` `NULL` for every entry (FR-007). Depends
  on T025. (Backend-only)
- [X] T028 [P] [US3] Write `apps/api/tests/integration/provision-tenant-duplicate-department.test.ts`:
  a call whose `departments` list contains two entries with the same `name` returns `409` and leaves
  no `tenants`, `departments`, `users`, or `user_roles` row from that attempt (FR-013). Depends on
  T025. (Backend-only)

**Checkpoint**: All three user stories complete — the full, atomic, spec-compliant
`POST /provisioning/tenants` flow exists end-to-end.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T029 [P] Write `apps/api/tests/integration/provision-tenant-cross-tenant-isolation.test.ts`:
  provision two tenants via the real endpoint; confirm zero cross-tenant visibility of each other's
  departments/users/roles through each tenant's own `request.tenantDb` context (SC-003,
  quickstart.md Scenario 4). Depends on T025.
- [X] T030 [P] **Frontend — needs UI-UX-Pro-Max skill.** Build the provisioning wizard at
  `apps/web/app/provisioning/new/page.tsx` (company details → department review/customization → admin
  details, single submit to `POST /provisioning/tenants`), following the same dev-header-stub +
  Tailwind/`@tm/ui` conventions as `apps/web/app/admin/permissions/page.tsx`. Per constitution
  Principle V: reference the established design system once locked, or explicitly flag a
  design-system proposal if none exists yet — do not introduce ad hoc styling. Depends on T025.
- [X] T031 [P] Expand `apps/api/drizzle/README.md`'s migration table with `0009`–`0016` (this
  feature's migrations), matching the existing table format and adding a short note on the
  `tenants`/`departments`/`users` RLS bootstrap idiom (research.md §1). Depends on T010, T016, T022.
  (Backend-only)
- [X] T032 Run `quickstart.md` end-to-end against the local `docker-compose.yml` Postgres instance and
  record the results (all six scenarios). Depends on all prior tasks. (Backend-only)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **Blocks all user stories** — schema, RLS, grants, and
  the transaction envelope all live here, proven correct by T012 before any story-specific logic is
  added.
- **User Stories (Phase 3–5)**: All depend on Foundational (through T012) being complete. Unlike Spec
  1, they are **sequential, not parallelizable**, because each phase extends the same
  `provisionTenant` function and the same route (T015 depends on T013; T024 depends on T015; T025
  depends on T017) — see "A note on story coupling" above.
- **Polish (Phase 6)**: Depends on all three user stories being complete (T025).

### User Story Dependencies

- **US1 (P1)**: Depends only on Foundational. The narrowest usable slice (tenant-record creation).
- **US2 (P1)**: Extends US1's code directly (same function, same file) — not independently deployable,
  but independently testable via T019–T021's assertions.
- **US3 (P2)**: Extends US2's code directly — same caveat.

### Downstream specs — what this feature must deliver for Specs 3, 4, 5

- **Spec 3 (auth method selection)** extends the `users` table (T004) with auth-specific columns; it
  does not create a new user table.
- **Spec 4 (theming/branding)** and **Spec 5 (plan-tier/feature-flags)** both attach new columns to the
  `tenants` table (T002) — neither requires any schema rework of what this feature ships (plan.md
  Summary; data-model.md `tenants` Non-goals).
- No task here implements Trial → Active → Suspended → Cancelled transition logic (spec FR-004
  explicitly excludes it) — whichever future spec adds tenant lifecycle status is responsible for that,
  building on the `status` column's existing `CHECK` constraint (T002) which already allows those
  values.

### Within Each User Story

- Schema/RLS/grants/envelope (Foundational) before any story-specific insert logic.
- Each story's core logic task before its HTTP-route wiring task, before its tests.
- Story complete before moving to the next priority (required here, not just recommended, due to the
  shared-function coupling above).

### Parallel Opportunities

- Foundational: T002, T003, T004 in parallel (different schema files); T006, T007, T008, T009, T010,
  T011 in parallel once T005 lands (six independent files); T012 in parallel with T011 (independent of
  the envelope, tests RLS directly).
- US2: T016 has no dependency on this feature's other Foundational/US1 work (touches only Spec 1
  tables) — can run any time after Phase 1. T019, T020, T021 in parallel once T018 lands.
- US3: T026, T027, T028 in parallel once T025 lands.
- Polish: T029, T030, T031 in parallel (independent files/concerns); T032 last, depends on everything.

---

## Parallel Example: Foundational schema + RLS

```bash
# T002, T003, T004 (different schema files) can start together:
Task: "Define tenants table schema in apps/api/src/db/schema/tenants.ts"
Task: "Define department_templates and departments table schemas in apps/api/src/db/schema/departments.ts"
Task: "Define users table schema in apps/api/src/db/schema/users.ts"

# After T005 (generated migration) lands, these are independent files:
Task: "Author apps/api/drizzle/0010_rls_tenants.sql"
Task: "Author apps/api/drizzle/0011_rls_departments.sql"
Task: "Author apps/api/drizzle/0012_rls_users.sql"
Task: "Author apps/api/drizzle/0013_lock_department_catalog_grants.sql"
Task: "Author apps/api/drizzle/0014_add_user_roles_users_fk.sql"
```

## Parallel Example: User Story 2 tests

```bash
# After T018 (route registered) lands, these three are independent test files:
Task: "Write apps/api/tests/integration/provision-tenant-admin-role.test.ts"
Task: "Write apps/api/tests/integration/provision-tenant-missing-role-template.test.ts"
Task: "Write apps/api/tests/integration/provision-tenant-forbidden.test.ts"
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2 — both P1)

1. Complete Phase 1: Setup (confirm no new deps).
2. Complete Phase 2: Foundational (schema → RLS → grants → transaction envelope, proven by T012).
3. Complete Phase 3: User Story 1 (tenant-record creation).
4. Complete Phase 4: User Story 2 (admin + role assignment, HTTP-reachable) — this is the true MVP,
   since spec.md itself marks both US1 and US2 as P1 ("a provisioned tenant with no usable login is
   not a usable tenant").
5. **STOP and VALIDATE**: run quickstart.md Scenarios 1 (partially — no department customization yet),
   3, 5, 6.
6. Departments will default to none until US3 lands — do not demo this checkpoint as FR-006-complete.

### Incremental Delivery

1. Setup + Foundational → the isolated, RLS-proven substrate.
2. Add US1 → tenant-record creation proven.
3. Add US2 → atomic, HTTP-reachable tenant+admin+role flow (MVP).
4. Add US3 → default + customizable departments, spec-complete (FR-006/FR-007).
5. Polish → cross-tenant isolation proof against the real endpoint, the demoable wizard screen,
   documentation, full quickstart run.

### Package Install Checkpoint

No task in this list installs a new package (T001 is a confirmation, not an install) — if
implementation reveals a need for something else, stop and get explicit sign-off per constitution
Principle XIII before adding it.
