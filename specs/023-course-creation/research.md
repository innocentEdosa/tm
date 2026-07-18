# Research: Course Creation

All Technical Context items were resolvable from the existing codebase (`apps/api`), the ratified
spec, and the constitution. No item required an open research spike; each decision below states what
was chosen, why, and what alternatives were rejected.

## 1. Two new tables: `courses` and `course_categories`, not an extension of an existing table

**Decision**: Add two brand-new tenant-scoped tables — `courses` (the catalog entry) and
`course_categories` (the tenant-seeded, tenant-extensible taxonomy) — plus a platform-global
`course_category_templates` table mirroring the existing `department_templates` seeding pattern.

**Rationale**: Nothing in this codebase today models a course or a category. The
`department_templates` → `departments` shape (`apps/api/src/db/schema/departments.ts`) is an exact
precedent for "platform-seeded defaults, tenant-owned rows, tenant can add more" — reusing that shape
for `course_category_templates` → `course_categories` means no new pattern is introduced, just a
second application of an already-reviewed one.

**Alternatives considered**:
- Storing category as a plain `text` column on `courses` with an application-level fixed list —
  rejected per Clarifications: category must be tenant-configurable (Constitution Principle II/III),
  which needs its own row-per-value table, not a column-level enum.
- A single `courses` table with category inlined as free text (no `course_categories` table at all,
  dedupe by exact string match only) — rejected: loses case-insensitive dedupe (spec Edge Cases) and
  gives no clean way to serve `GET .../categories` for a future picker.

## 2. Isolation model: shared schema + RLS, identical to `departments`/`training_needs`

**Decision**: Both new tables get `tenant_id uuid not null references tenants(id)`, RLS
enabled+forced with the standard `tenant_isolation` policy
(`USING/WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)`), following the exact
migration sequence already used for every prior tenant-scoped table (schema migration → RLS-enable
migration → grants-lock migration).

**Rationale**: Constitution Principle I requires this by default; no aspect of this spec's data
(course records, categories) has any reason to deviate from the platform's one shared-schema-with-RLS
isolation model. `request.tenantDb` already resolves `app.tenant_id` per-request (existing
`tenant-context` plugin) — course routes need no new tenant-scoping mechanism.

**Alternatives considered**: None seriously — deviating from RLS for a new tenant table would be a
constitution-level decision (Principle I explicitly forbids ad hoc exceptions), not a per-feature one.

## 3. Category creation is inline-only: no dedicated `POST .../categories` write endpoint

**Decision**: A category is created only as a side effect of `POST`/`PATCH .../courses` supplying a
`category` name that doesn't already exist for the tenant (case-insensitive match). There is a
`GET .../categories` read endpoint (FR-001c) but no standalone `POST`/`PATCH`/`DELETE` for categories
in this spec.

**Rationale**: Matches the Clarifications answer precisely ("add a new category by simply specifying a
name... while creating or editing a course... no separate category-management step required") and
keeps this spec's API surface as small as the Department Management spec's own depth target. A full
category CRUD surface (rename, delete, merge) is a real future need but wasn't asked for and isn't
implied by "the same form input" — building it now would be scope creep against the spec's own
explicit non-goals (no bulk actions, no versioning, matching spec 009's depth).

**Alternatives considered**:
- A separate `POST .../course-categories` endpoint the client calls first, then references the
  returned id on course create — rejected: adds a required round-trip the Clarifications answer
  explicitly avoided ("no separate category-management step required"); the inline upsert is strictly
  simpler for the same outcome.
- Auto-creating categories with no `course.manage` gate at all (any authenticated user could mint a
  category) — rejected: category creation is a write, gated the same as every other course write
  (FR-008), consistent with categories being reachable only through `course.manage`-gated course
  create/update.

## 4. Category matching: case-insensitive, whitespace-trimmed, single-statement `ON CONFLICT` upsert

**Decision**: On course create/update, normalize the incoming category name (`trim()`, compare
case-insensitively via `lower()`). Look it up in `course_categories` for the tenant; if found, use its
id. If not found, run `INSERT INTO course_categories (...) VALUES (...) ON CONFLICT (tenant_id,
lower(name)) DO NOTHING RETURNING id` against the case-insensitive unique index
(`course_categories_tenant_id_name_unique` — the same expression-index technique
`departments_tenant_id_name_unique` already uses, `apps/api/src/db/schema/departments.ts`); if that
insert returns no row (lost the race to a concurrent identical insert), re-run the lookup `SELECT` to
fetch the id the other request just created.

**Rationale**: A single `INSERT ... ON CONFLICT ... DO NOTHING RETURNING` is Postgres's standard,
built-in tool for exactly this "insert-if-absent, otherwise use the existing row" shape — no explicit
row lock or catch-and-retry-on-exception needed, and no new mechanism introduced (Principle XII).

**Alternatives considered**:
- `SELECT ... FOR UPDATE` / advisory lock around the lookup-then-insert — rejected: heavier than
  necessary; `ON CONFLICT DO NOTHING` fully closes the race in one round trip.
- Catch the `23505` unique-violation exception and retry (the pattern `tenant-department-routes.ts`
  uses for rejecting a duplicate department name) — rejected here specifically: that pattern fits
  departments because a duplicate name there is a *user-facing error* (`409`, "name already exists").
  Here a "duplicate" category name is not an error at all — it's the expected, desired outcome
  (resolve to the existing category) — so `ON CONFLICT DO NOTHING RETURNING` is the better fit,
  since it expresses "succeed either way" directly rather than routing the expected case through
  exception handling.

## 5. Permission keys: `course.view` / `course.manage`, seeded and granted like `department.*`

**Decision**: Add `course.view` and `course.manage` to the `permissions` catalog via a migration that
mirrors `0025_seed_department_permissions.sql` exactly — insert the two rows, grant both to the
`hr_admin` role template (for future tenant provisioning), and backfill both onto every already-live
tenant's `hr_admin`-sourced role row (matching by `source_template_id` **and** by role name in the same
statement, per `0038`'s combined-approach lesson learned from `0025`/`0026`'s two-step correction).
`course.manage` is enforced as inherently including `course.view` the same way as
`department.manage`/`department.view` — every manage-gated route also accepts a caller holding
`course.manage` for its read parts (`requireAnyPermission("course.view", "course.manage")`), not by one
permission row implying another in the catalog itself.

**Rationale**: Direct continuation of an already-established, twice-corrected pattern — no reason to
deviate, and applying the `0038`-learned combined role-name/`source_template_id` backfill from the
start avoids repeating `0025`/`0026`'s original two-migration mistake.

**Alternatives considered**:
- Reusing an existing permission (e.g. `department.manage`) instead of new keys — explicitly rejected
  by the user during scoping; courses are a distinct module from departments.

## 6. Route module: new `apps/api/src/courses/tenant-course-routes.ts` plugin

**Decision**: New directory `apps/api/src/courses/`, one Fastify plugin file
`tenant-course-routes.ts` exporting the five routes (list courses, get course, create course, update
course, archive course) plus the categories read route, registered in `server.ts` alongside the other
tenant route plugins (`tenantDepartmentRoutes`, `tenantTrainingNeedsRoutes`, etc.).

**Rationale**: Matches this codebase's one-plugin-per-feature-module convention exactly (`departments/
tenant-department-routes.ts`, `training-needs/tenant-training-needs-routes.ts`) — no reason to deviate
for a new, unrelated module.

**Alternatives considered**: Folding course routes into an existing plugin file — rejected: courses are
a distinct entity with no relationship to any existing module's routes in this spec.

## 7. Pagination: same page/pageSize query-param shape as Training Needs' list endpoint

**Decision**: `GET .../courses` supports `page`/`pageSize` query params, defaulting and clamping
exactly like `tenant-training-needs-routes.ts` (`Math.max(1, parseInt(...) || default)`), returning
`{ success: true, data: [...], pagination: { page, pageSize, total } }`.

**Rationale**: Spec Edge Cases explicitly requires empty-result behavior past the last page and SC-002
requires no perceptible delay at 500+ rows — unlike Department Management (which explicitly has no
pagination, per its own contract's Non-goals, at "tens to low hundreds of rows"), this spec's own
Success Criteria names a 500+-row scale, so reusing the codebase's one existing pagination
precedent (rather than inventing a new shape, or returning everything unpaginated) is the correct,
already-reviewed choice.

**Alternatives considered**:
- No pagination, full list returned (Department Management's approach) — rejected: SC-002 explicitly
  names catalog sizes (500+) large enough that this spec's own success criteria implies pagination is
  warranted, unlike Department Management's stated tens-to-hundreds scale.

## 8. `updated_at` maintenance: application-set on every write, no DB trigger

**Decision**: `updatedAt` is set explicitly (`new Date()`) in every `UPDATE` statement's `SET` clause
inside route handlers, exactly like `departments`' `PATCH` handler — no Postgres trigger.

**Rationale**: Continuation of §3 in the Department Management research (no trigger precedent exists
anywhere in this codebase's migrations; introducing one here would be a new mechanism for one feature,
against Principle XII).

**Alternatives considered**: A `BEFORE UPDATE` trigger — rejected for the same reasons already
established and reviewed in the Department Management spec's own research.md §3.

## 9. Testing: Vitest integration tests against real Postgres, mirroring `department-*.test.ts`

**Decision**: New behavior (tenant isolation, permission gating, category auto-create/dedupe, status
transitions, archive idempotency) is covered by new files under `apps/api/tests/integration/`
(`course-*.test.ts`), run via the existing `vitest run` script against a real Postgres connection — the
same convention `department-permission-gating.test.ts` / `department-cross-tenant-parent-blocked.test.ts`
already establish.

**Rationale**: This is the codebase's only existing testing convention for RLS/permission-gated
behavior; a mocked database cannot prove RLS or a unique-index race actually behaves as designed.

**Alternatives considered**: None seriously — straightforward continuation of an existing, working
convention.

## 10. No web UI, no route in `apps/web`

**Decision**: This spec adds zero files under `apps/web`. The existing disabled "Courses" nav entry
(`apps/web/app/(dashboard-shell)/layout.tsx:77`) is left untouched.

**Rationale**: Explicit scope boundary from Assumptions/Constitution Alignment — API/data-model only.

**Alternatives considered**: N/A — out of scope by explicit user decision during spec scoping.
