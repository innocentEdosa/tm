---

description: "Task list for implementing the Roles & Permissions Model feature"
---

# Tasks: Roles & Permissions Model

**Input**: Design documents from `/specs/001-roles-permissions-model/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md,
contracts/ (`super-admin-catalog-api.md`, `seed-default-roles-interface.md`,
`tenant-role-management-api.md`), quickstart.md

**Tests**: Included — the spec explicitly requires proof that cross-tenant access is blocked, and the
plan explicitly requires test coverage for permission-check logic and RLS correctness. Test tasks are
not optional in this feature.

**Dependency sign-off status**: `drizzle-orm`, `drizzle-kit`, and `vitest` were approved by the user
during `/speckit-plan` (2026-07-01, constitution Principle XIII). T001 performs the actual install —
no other task should run `pnpm add`.

## Format: `[ID] [P?] [Story?] Description with file path (Backend-only | Frontend — needs UI-UX-Pro-Max skill)`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Maps the task to its user story (US1, US2, US3); Setup/Foundational/Polish tasks carry
  no story label
- Every task states whether it's backend-only or has a frontend component, per this feature's request

---

## Phase 1: Setup

**Purpose**: Approve/install tooling and configure it, before any schema or code is written.

- [X] T001 ⚠️ **PACKAGE INSTALL (Principle XIII — already approved)** Add `drizzle-orm` as a runtime
  dependency and `drizzle-kit`, `vitest` as dev dependencies of `apps/api` (`apps/api/package.json`,
  run via `pnpm add`). Do not bundle any other install into this task or any later one. (Backend-only)
- [X] T002 [P] Create Drizzle Kit config `apps/api/drizzle.config.ts` (schema glob pointing at
  `src/db/schema/*`, migrations output `apps/api/drizzle/`, `dialect: "postgresql"`, credentials from
  `DATABASE_URL`). (Backend-only)
- [X] T003 [P] Create Vitest config `apps/api/vitest.config.ts` (Node environment, test glob
  `src/**/*.test.ts` and `tests/**/*.test.ts`, add a `test` script to `apps/api/package.json`).
  (Backend-only)
- [X] T004 [P] Update `apps/api/.env.example` with `DATABASE_URL` guidance distinguishing Neon's pooled
  (`-pooler`) connection string (required outside local dev) from the direct string, per research.md
  §5. (Backend-only)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema → RLS → tenant-context → enforcement primitive, in that order, per the required
sequencing. **Nothing in Phase 3+ can start until this phase (through T021) is complete.**

- [X] T005 [P] Define `permissions` table schema in `apps/api/src/db/schema/permissions.ts` (global,
  no `tenant_id`; `key` unique text, `display_name`, `description`, `category`, `created_at`).
  (Backend-only)
- [X] T006 [P] Define `role_templates` table schema in `apps/api/src/db/schema/role-templates.ts`
  (global, no `tenant_id`; `key` unique, `name`, `description`, `is_platform_only` boolean default
  false, `created_at`). (Backend-only)
- [X] T007 Define `role_template_permissions` join table schema in
  `apps/api/src/db/schema/role-templates.ts` (composite PK `role_template_id` + `permission_id`,
  same file as T006 — sequential, not parallel). (Backend-only)
- [X] T008 [P] Define `roles` table schema in `apps/api/src/db/schema/roles.ts` (nullable `tenant_id`,
  partial unique index enforcing at most one `tenant_id IS NULL` row, unique `(tenant_id, name)`,
  `source_template_id` nullable FK to `role_templates`, `created_at`/`updated_at`). (Backend-only)
- [X] T009 Define `role_permissions` join table schema in `apps/api/src/db/schema/roles.ts` (composite
  PK `role_id` + `permission_id`, same file as T008 — sequential). (Backend-only)
- [X] T010 Define `user_roles` table schema in `apps/api/src/db/schema/roles.ts` (`tenant_id`,
  `user_id`, `role_id` FK `ON DELETE RESTRICT`, unique `(user_id, role_id)`, same file as T008/T009 —
  sequential). (Backend-only)
- [X] T011 Generate the initial Drizzle migration from T005–T010 via `drizzle-kit generate`, producing
  `apps/api/drizzle/0000_init_roles_permissions.sql`. Depends on T005–T010. (Backend-only)
- [X] T012 [P] Author the paired down-migration `apps/api/drizzle/0000_init_roles_permissions_down.sql`
  (drops the six tables in reverse FK order) and a short rollback runbook note in
  `apps/api/drizzle/README.md`, per the plan's rollback requirement. Depends on T011. (Backend-only)
- [X] T013 [P] Author `apps/api/drizzle/0001_lock_catalog_grants.sql`: `REVOKE INSERT, UPDATE, DELETE`
  on `permissions`, `role_templates`, `role_template_permissions` from the application's runtime DB
  role, leaving `SELECT` only (FR-002). Depends on T011. (Backend-only)
- [X] T014 [P] Author `apps/api/drizzle/0002_rls_roles.sql`: `ALTER TABLE roles ENABLE ROW LEVEL
  SECURITY`, `FORCE ROW LEVEL SECURITY`, and a policy `USING (tenant_id = current_setting('app.tenant_id',
  true)::uuid) WITH CHECK (same)`. Depends on T011. (Backend-only)
- [X] T015 [P] Author `apps/api/drizzle/0003_rls_role_permissions.sql`: RLS policy on
  `role_permissions` via `EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND
  r.tenant_id = current_setting('app.tenant_id', true)::uuid)` for both `USING` and `WITH CHECK`.
  Depends on T011. (Backend-only)
- [X] T016 [P] Author `apps/api/drizzle/0004_rls_user_roles.sql`: RLS policy on `user_roles` via
  `USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (same)`. Depends on
  T011. (Backend-only)
- [X] T017 [P] Create `apps/api/src/db/client.ts` binding `drizzle(fastify.pg.pool)` (per research.md
  §1) and set the `pg.Pool` `max: 10` option on `@fastify/postgres`'s registration options in
  `apps/api/src/server.ts` (per research.md §5). Depends on T001, T004. (Backend-only)
- [X] T018 [P] Create the tenant-context Fastify plugin `apps/api/src/plugins/tenant-context.ts`:
  on every request, check out a client from `fastify.pg.pool`, `BEGIN`, `SET LOCAL app.tenant_id`
  using **only** `request.user.tenantId` from the authenticated session (never a client-supplied
  header/body value), decorate `request.tenantDb` with a Drizzle instance bound to that client, and
  `COMMIT`/`ROLLBACK` + release on `onResponse`/`onError` (per research.md §2–3). Depends on T017.
  (Backend-only)
- [X] T019 Register the tenant-context plugin in `apps/api/src/server.ts`. Depends on T018.
  (Backend-only)
- [X] T020 [P] Create `apps/api/src/permissions/require-permission.ts` exporting
  `requirePermission(permissionKey)`, a `preHandler` factory that queries `request.tenantDb`
  (`user_roles` → `role_permissions` → `permissions`) for the key, replying `403` if absent (deny by
  default when the user has zero roles, FR-010). Depends on T018. (Backend-only)
- [X] T021 **Cross-tenant access test (required, not bundled).** Write
  `apps/api/tests/integration/rls-cross-tenant.test.ts` (Vitest): seed two test tenants each with
  their own role; open a transaction for tenant A (`SET LOCAL app.tenant_id`) and assert it returns
  zero rows for a `SELECT ... WHERE id = <tenant-B-role-id>` and zero rows affected for an `UPDATE`
  against that same id, even though the row exists and the id is correct; separately assert that a
  transaction with `app.tenant_id` unset returns zero rows or errors on `SELECT * FROM roles` —
  never all tenants' rows (quickstart.md §2). Depends on T014, T015, T016. (Backend-only)

**Checkpoint**: Schema, RLS, tenant-context propagation, and the enforcement primitive all exist and
are proven — by T021 — to isolate tenants correctly. User story phases can now begin.

---

## Phase 3: User Story 1 - Platform-Wide Permission Catalog & Default Role Templates (Priority: P1) 🎯 MVP

**Goal**: The permission catalog and all four default role templates exist, are queryable, and are
copyable into a tenant — with zero tenants provisioned yet.

**Independent Test**: Query the permission catalog and role templates via the Super Admin API with no
tenants in the system, and confirm each of the four templates maps to its expected permission set.

- [X] T022 [P] [US1] Seed the permission catalog — `approve_enrollment`, `edit_content_library`,
  `view_department_analytics`, `manage_roles`, `view_permission_catalog` — via
  `apps/api/drizzle/0005_seed_permissions.sql`. (`manage_roles` and `view_permission_catalog` are
  included here so User Story 3's and the Super Admin view's endpoints have a permission to check
  against later.) Depends on T013. (Backend-only)
- [X] T023 [US1] [PREREQUISITE FOR: Tenant Provisioning spec] Seed the four default role templates —
  `super_admin` (`is_platform_only = true`), `hr_admin`, `manager`, `employee` — and their
  `role_template_permissions` mappings, via `apps/api/drizzle/0006_seed_role_templates.sql`. Depends
  on T022. (Backend-only)
- [X] T024 [US1] Seed the single platform-level Super Admin role (`roles.tenant_id = NULL`) and its
  `role_permissions`, via a one-time migration `apps/api/drizzle/0007_seed_super_admin_role.sql` (not
  per-tenant — per research.md §4). Depends on T023. (Backend-only)
- [X] T025 [P] [US1] Implement `GET /admin/permissions` in `apps/api/src/permissions/admin-routes.ts`
  per `contracts/super-admin-catalog-api.md`, guarded by `requirePermission("view_permission_catalog")`
  plus a check that the caller's role is the platform Super Admin role. Depends on T022, T020.
  (Backend-only)

  Implementation note: guarded by `requirePlatformPermission("view_permission_catalog")`
  (`apps/api/src/permissions/require-platform-permission.ts`), not `requirePermission` — these
  routes intentionally run outside the per-request tenant transaction (contracts/
  super-admin-catalog-api.md), and RLS makes the Super Admin's `user_roles` row unreachable via the
  normal tenant-scoped `tm_app` connection by design (FR-007). Verifying Super Admin membership at
  all requires the narrow `tm_platform_reader` (BYPASSRLS) role — see drizzle/README.md
  "Platform-reader role" and 0008_platform_reader_grants.sql. Confirmed with the user before
  building this (added infra beyond what T013 alone implied).
- [X] T026 [P] [US1] Implement `GET /admin/role-templates` in `apps/api/src/permissions/admin-routes.ts`
  per `contracts/super-admin-catalog-api.md`, including each template's mapped permission keys.
  Depends on T023, T020. (Backend-only)
- [X] T027 Register `admin-routes` in `apps/api/src/server.ts`. Depends on T025, T026. (Backend-only)
- [X] T028 [US1] [PREREQUISITE FOR: Tenant Provisioning spec] Implement
  `seedDefaultRolesForTenant(tenantDb, tenantId)` in `apps/api/src/permissions/seed-default-roles.ts`
  per `contracts/seed-default-roles-interface.md` — copies every non-platform-only `role_templates`
  row (and its permissions) into the caller's tenant-scoped `roles`/`role_permissions`; excludes the
  Super Admin template. Depends on T023, T017. (Backend-only)
- [X] T029 [US1] Write `apps/api/tests/integration/seed-default-roles.test.ts`: a fresh test tenant
  ends up with exactly 3 roles (`hr_admin`, `manager`, `employee` — not `super_admin`) matching their
  source templates' permissions; calling the function twice for the same tenant fails on the
  `(tenant_id, name)` unique constraint rather than duplicating rows. Depends on T028. (Backend-only)
- [X] T030 [US1] **Frontend — needs UI-UX-Pro-Max skill.** Build the minimal Super Admin read-only
  catalog/template view at `apps/web/app/admin/permissions/page.tsx`, fetching
  `GET /admin/permissions` and `GET /admin/role-templates`. Per constitution Principle V: this screen
  must reference the established design system once locked, or explicitly flag a design-system
  proposal if none exists yet — do not introduce ad hoc styling. Depends on T027.

**Checkpoint**: US1 complete and independently demoable — this is the suggested MVP scope.

---

## Phase 4: User Story 2 - Server-Side Enforcement of Every Protected Action (Priority: P2)

**Goal**: Prove that `requirePermission` + the tenant-context transaction genuinely deny
under-permissioned, roleless, tenant-spoofed, and role-spoofed requests — independent of any UI.

**Independent Test**: Attempt a protected action as a user whose role lacks the permission, and
separately with a spoofed tenant claim; confirm denial both times.

- [X] T031 [US2] Create a minimal demonstration protected route,
  `POST /_internal/protected-demo` guarded by `requirePermission("approve_enrollment")`, in
  `apps/api/src/permissions/demo-routes.ts` — solely to exercise the enforcement pattern end-to-end
  ahead of any real business feature depending on it, and register it in `apps/api/src/server.ts`.
  Depends on T020, T019. (Backend-only)
- [X] T032 [P] [US2] Write `apps/api/tests/integration/enforcement-permission-denied.test.ts`: a user
  whose assigned role does not include `approve_enrollment` receives `403` from the demo route.
  Depends on T031. (Backend-only)
- [X] T033 [P] [US2] Write `apps/api/tests/integration/enforcement-zero-roles.test.ts`: a user with no
  `user_roles` rows at all receives `403` from the demo route (deny by default, FR-010). Depends on
  T031. (Backend-only)
- [X] T034 [P] [US2] Write `apps/api/tests/integration/enforcement-tenant-spoof.test.ts`: a request
  carrying a spoofed tenant identifier in a header/body (different from the authenticated session's
  actual tenant) is evaluated using the server-verified tenant only — the result matches what the
  real tenant's permissions dictate, never the spoofed one. Depends on T031. (Backend-only)
- [X] T035 [P] [US2] Write `apps/api/tests/integration/enforcement-role-claim-spoof.test.ts`: send a
  request to the demo route with a client-supplied role/permission claim (e.g. a header or body field
  asserting the caller holds `approve_enrollment`) from a user whose actual DB-backed roles do not
  grant it; assert the system denies the action based on the DB-verified assignment, never the
  client's claim (spec SC-003 — spoofed role claim). Depends on T031. (Backend-only)

**Checkpoint**: US2 complete — the enforcement backbone is proven correct independent of any real
business endpoint.

---

## Phase 5: User Story 3 - Per-Tenant Role Customization Without Code Changes (Priority: P3)

**Goal**: A tenant admin can rename a role, add/remove its permissions, and create new roles — scoped
to their own tenant, with zero code changes or deployment, and zero effect on other tenants — and the
platform Super Admin role remains completely unreachable through this surface.

**Independent Test**: Using a seeded test tenant, rename a role, remove one permission, create a new
role from catalog permissions, and confirm isolation from a second test tenant.

- [X] T036 [US3] Implement `PATCH /tenant/roles/:roleId` (rename, update description, replace
  permission set) in `apps/api/src/permissions/tenant-role-routes.ts` per
  `contracts/tenant-role-management-api.md`, operating through `request.tenantDb` (RLS-scoped) and
  guarded by `requirePermission("manage_roles")`. Depends on T022, T020. (Backend-only)
- [X] T037 [US3] Implement `POST /tenant/roles` (create a new role from selected catalog permissions)
  in `apps/api/src/permissions/tenant-role-routes.ts` per `contracts/tenant-role-management-api.md`
  (same file as T036 — sequential, not parallel). Depends on T036. (Backend-only)
- [X] T038 [US3] Implement `DELETE /tenant/roles/:roleId` in
  `apps/api/src/permissions/tenant-role-routes.ts` per `contracts/tenant-role-management-api.md`,
  returning `409` when the FK `ON DELETE RESTRICT` constraint blocks deletion because users are still
  assigned (FR-012), same file as T036/T037 — sequential. Depends on T037. (Backend-only)
- [X] T039 Register `tenant-role-routes` in `apps/api/src/server.ts`. Depends on T038. (Backend-only)
- [X] T040 [P] [US3] Write `apps/api/tests/integration/tenant-role-customization.test.ts`: a tenant
  admin renames a role and removes a permission via `PATCH /tenant/roles/:roleId`; the change is
  scoped to that tenant only and requires no code change or deployment. Depends on T039.
  (Backend-only)
- [X] T041 [P] [US3] Write `apps/api/tests/integration/tenant-role-creation.test.ts`: a tenant admin
  creates a new role via `POST /tenant/roles`; a user assigned that role has effective permissions
  matching exactly the new role's set. Depends on T039. (Backend-only)
- [X] T042 [US3] Write `apps/api/tests/integration/tenant-role-isolation.test.ts`: with two isolated
  test tenants, one renames/reconfigures a role via the endpoints above; confirm the other tenant's
  roles are entirely unaffected (spec Acceptance Scenario 3). Depends on T040, T041. (Backend-only)
- [X] T043 [P] [US3] Write `apps/api/tests/integration/tenant-role-delete-blocked.test.ts`: deleting a
  role that still has `user_roles` referencing it via `DELETE /tenant/roles/:roleId` returns `409` and
  the role is not deleted. Depends on T038. (Backend-only)
- [X] T044 [US3] Write `apps/api/tests/integration/tenant-cannot-target-super-admin.test.ts`: from any
  tenant's authenticated context, attempt `PATCH /tenant/roles/:roleId` and
  `DELETE /tenant/roles/:roleId` using the platform Super Admin role's known id; assert both return
  `404` and the Super Admin role is unchanged (FR-007, spec.md Edge Cases). Depends on T039.
  (Backend-only)

**Checkpoint**: US3 complete — full tenant self-service role customization proven end-to-end, with the
Super Admin role proven unreachable through it.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T045 [P] Write `apps/api/tests/unit/effective-permissions.test.ts`: a pure-function unit test
  (no DB) for the permission-union-across-roles resolution logic. (Backend-only)
- [X] T046 [P] Expand `apps/api/drizzle/README.md` with the full migration/rollback runbook and the
  pooled-Neon-connection operational notes referenced in T012/T004. (Backend-only)
- [X] T047 Run `quickstart.md` end-to-end against the local `docker-compose.yml` Postgres instance and
  record the results (all five validation sections). Depends on all prior tasks. (Backend-only)
- [X] T048 [P] Write `apps/api/tests/integration/permission-catalog-no-auto-grant.test.ts`: insert a
  brand-new permission row into `permissions` after the initial seed (T022/T023) has run; assert it
  does not appear in any existing role's `role_permissions` — default templates (T023), the platform
  Super Admin role (T024), and any tenant roles created during earlier tests (T028, T037) — confirming
  FR-011/SC-005. Depends on T023, T024, T028. (Backend-only)
- [X] T049 [P] Write `apps/api/tests/integration/effective-permissions-multi-role.test.ts`: assign a
  user two roles where only the second grants a given permission; call the demo route (T031) guarded
  by that permission and assert access is granted — proving union resolution through the real
  `requirePermission`/`request.tenantDb` path, not just the pure-function unit test (T045). Depends on
  T031, T028. (Backend-only)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup (needs `drizzle-orm`/`drizzle-kit`/`vitest` installed —
  T021's cross-tenant test already requires Vitest). **Blocks all user stories** — this is where the
  user's required ordering (schema → RLS → enforcement) lives.
- **User Stories (Phase 3–5)**: All depend on Foundational (through T021) being complete. They may
  then proceed in parallel if staffed, or sequentially in priority order (US1 → US2 → US3).
- **Polish (Phase 6)**: Depends on whichever user stories are in scope for the release being complete.

### User Story Dependencies

- **US1 (P1)**: No dependency on US2 or US3. This is the MVP.
- **US2 (P2)**: No dependency on US1's data (uses its own demo route) or US3 — independently testable,
  sequenced second only because it's the natural next proof point after the catalog exists.
- **US3 (P3)**: Uses the `manage_roles`/catalog permissions seeded in US1 (T022); does not depend on
  US2's demo route.

### Tenant Provisioning spec — prerequisites this feature must deliver

The (separate, out-of-scope-here) Tenant Provisioning spec will consume:
- **T023** — the four seeded role templates it will copy from.
- **T028** — the `seedDefaultRolesForTenant(tenantDb, tenantId)` function it will call, inside its own
  tenant's transaction, at provisioning time.

No other task in this feature is a direct interface for that spec; the rest is either global catalog
setup, RLS/enforcement infrastructure, or this feature's own demoable/tenant-self-service surface.

Note: the constitution's downgrade/cancellation requirement (spec.md Constitution Alignment) asserts
enforcement must keep denying a cancelled tenant's users, but no task here implements a tenant-status
check — that behavior depends on a `tenants` table this feature does not own. Whichever spec introduces
tenant lifecycle status is responsible for wiring that check into the tenant-context plugin (T018) or
`requirePermission` (T020); it is not yet covered by any task in this list.

### Within Each User Story

- Schema/RLS/enforcement primitives (Foundational) before any story-specific route.
- Route implementation before the tests that exercise it (tests are written against the real route in
  this feature, not TDD-first, since the enforcement primitive itself was already proven in Phase 2).
- Story complete before moving to the next priority, if working sequentially.

### Parallel Opportunities

- Setup: T002, T003, T004 in parallel (T001 first, since it installs what T002/T003 configure).
- Foundational: T005, T006, T008 in parallel (different schema files); T012, T013, T014, T015, T016 in
  parallel once T011 lands (five independent migration files); T017, T018, T020 in parallel once T001
  lands (different files, only depend on already-complete work).
- US1: T025 and T026 in parallel (different route handlers, same file — coordinate if working
  simultaneously); T022 in parallel with Foundational's T017–T021 (different concern entirely, only
  needs T013).
- US2: T032, T033, T034, T035 all in parallel once T031 lands (four independent test files).
- US3: T040, T041, T043 in parallel once T039 lands; T042 depends on both T040 and T041 completing;
  T044 depends only on T039.
- Polish: T045, T046, T048, T049 in parallel (four independent test/doc files, each only depending on
  already-complete earlier tasks).

---

## Parallel Example: Foundational RLS policies

```bash
# After T011 (initial migration) lands, these three are independent files:
Task: "Author apps/api/drizzle/0002_rls_roles.sql"
Task: "Author apps/api/drizzle/0003_rls_role_permissions.sql"
Task: "Author apps/api/drizzle/0004_rls_user_roles.sql"
```

## Parallel Example: User Story 2 tests

```bash
# After T031 (demo route) lands, these four are independent test files:
Task: "Write apps/api/tests/integration/enforcement-permission-denied.test.ts"
Task: "Write apps/api/tests/integration/enforcement-zero-roles.test.ts"
Task: "Write apps/api/tests/integration/enforcement-tenant-spoof.test.ts"
Task: "Write apps/api/tests/integration/enforcement-role-claim-spoof.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (install approved dependencies, configure tooling).
2. Complete Phase 2: Foundational (schema → RLS → tenant-context → enforcement primitive → proven via
   the cross-tenant test, T021). **This is the largest, highest-risk phase — it is the security
   backbone everything else depends on.**
3. Complete Phase 3: User Story 1 (catalog, templates, Super Admin view, provisioning interface).
4. **STOP and VALIDATE**: run `quickstart.md` §1 and §4 against the MVP.
5. Demo: the Super Admin catalog/template view (T030) plus the `seedDefaultRolesForTenant` interface.

### Incremental Delivery

1. Setup + Foundational → the isolated, tested security backbone.
2. Add US1 → demoable MVP (catalog + templates + Super Admin view + provisioning interface).
3. Add US2 → enforcement proven against a real (if minimal) protected route, including role-claim
   spoofing.
4. Add US3 → full tenant self-service role customization, including proof the Super Admin role can't
   be targeted from a tenant context.
5. Polish → unit + integration tests for the union logic, the no-auto-grant guarantee, documentation,
   full quickstart run.

### Package Install Checkpoint

Only **T001** installs new packages (`drizzle-orm`, `drizzle-kit`, `vitest`) — all pre-approved during
`/speckit-plan`. No other task in this list should run `pnpm add`; if implementation reveals a need
for something else, stop and get explicit sign-off per constitution Principle XIII before adding it.
