# Research: Course Content

All Technical Context items were resolvable from the existing codebase (`apps/api`, now including the
Course Creation spec's own tables/routes), the ratified spec, and the constitution. No item required an
open research spike.

## 1. Two new tables: `course_modules` and `content_items`, extending Course Creation's `courses`

**Decision**: Add `course_modules` (tenant-scoped, one row per module, FK to `courses.id`) and
`content_items` (tenant-scoped, one row per content item, FK to `course_modules.id` and, denormalized,
to `courses.id`) under `apps/api/src/db/schema/course-content.ts`. No change to the existing `courses`
or `course_categories` tables from spec 023.

**Rationale**: Directly implements the polymorphic `content_items`-with-a-type-discriminator shape spec
023's own Clarifications already flagged, and the modules-from-the-start decision from this spec's own
Clarifications. Denormalizing `course_id` onto `content_items` (in addition to `module_id`) is safe
because a content item's course never changes — FR-008 only allows moving a content item to a
*different module within the same course*, never across courses — so `course_id` is write-once at
creation and needs no update-time sync logic. It also makes the curriculum-fetch query (spec FR-002) a
flat `WHERE course_id = :course` on each table instead of a `module_id IN (...)` join.

**Alternatives considered**:
- Content items reference only `module_id`, requiring a join through `course_modules` for any
  course-scoped query — rejected: adds a join to the one read path (full curriculum fetch) this spec's
  own SC-005 cares about, for no benefit given `course_id` can never drift.
- A single table with modules and content items unioned (a "container" flag) — rejected: modules and
  content items have meaningfully different shapes (a module has no `type`/payload; a content item
  always belongs to a module, never directly to a course) — forcing them into one table trades a small
  join for a much larger nullable-column mess.

## 2. Isolation model: shared schema + RLS, identical to every existing tenant table

**Decision**: Both new tables get `tenant_id uuid not null references tenants(id)`, RLS enabled+forced
with the standard `tenant_isolation` policy, same migration sequence (schema → RLS-enable → grants-lock)
as every prior tenant table including `courses`/`course_categories` themselves (0068-0071).

**Rationale**: Constitution Principle I; no aspect of this data deviates from the platform's one
isolation model. `tenant_id` is carried directly on both tables (not resolved solely via a join to
`courses`) so RLS can scope every row independently, matching the `training_needs`/`courses` precedent
of denormalizing `tenant_id` onto every tenant-owned row even when a parent FK could theoretically imply
it.

**Alternatives considered**: None seriously — an RLS deviation would be a constitution-level decision.

## 3. Polymorphic content: `type` (CHECK-constrained text) + `payload` (jsonb), app-layer validated

**Decision**: `content_items.type` is a `text` column with a `CHECK` constraint against the fixed
six-value enum (mirrors `courses.status`/`courses.delivery_mode`'s existing CHECK convention).
Type-specific fields (a video's URL; an article's body/external URL; a live class's schedule/
facilitator/meeting-link/capacity; a test's pass-criteria text; an external import's URL/source-type
label) live in a single `payload jsonb not null default '{}'` column, validated against a per-`type`
required-field set in the route handler at create/update time (spec FR-004/FR-005) — never at the
database layer.

**Rationale**: `jsonb` for a flexible, type-varying payload is already an established pattern in this
codebase (`custom_field_values.value`, `form_fields.options` — `apps/api/src/db/schema/custom-fields.ts`),
not a new mechanism. Application-layer validation per type mirrors the exact precedent
`validateCustomFieldValues` already sets for "a payload whose valid shape depends on a type/config value
looked up elsewhere" (`apps/api/src/custom-fields/save-values.ts`) — reusing an already-reviewed pattern
rather than inventing a `jsonb` CHECK-constraint DSL, which Postgres supports only clumsily for anything
beyond "is this valid JSON."

**Alternatives considered**:
- A wide table with one nullable column per possible type-specific field (`video_url`, `article_body`,
  `scheduled_at`, `pass_criteria`, ...) — rejected: six types' worth of mostly-null columns per row is
  exactly the mess spec 023's own Clarifications pre-emptively ruled out by specifying the polymorphic
  shape in the first place.
- Postgres `CHECK` constraints validating `payload`'s shape per `type` (e.g. a per-type JSON Schema
  check) — rejected: no precedent anywhere in this schema for constraint-level JSON validation, and
  `custom_field_values` already established that this class of validation belongs in the application
  layer, not the database.

## 4. Ordering: server-computed positions only, no client-supplied index, no DB-level uniqueness

**Decision**: `position` (plain `integer`) exists on both tables, but is **never** accepted as client
input on create or on a module-membership change (spec Clarifications — append-only placement). The
only three code paths that write `position` are: (a) create → `position = current count` (append last),
(b) reorder (FR-007) → the full submitted id list is rewritten to `0..N-1` in the request's existing
transaction, rejecting outright if the submitted id set doesn't exactly match the current set, (c)
module-membership change (FR-008) → `position = current count of the target module`. No unique
database constraint enforces `(course_id, position)`/`(module_id, position)` — the invariant is held
entirely by construction (every write path is server-computed, inside one transaction), and a `UNIQUE`
index cannot itself express "unique, but temporarily violatable mid-reorder-batch" without a
`DEFERRABLE` table constraint, which Drizzle's schema-first `drizzle-kit generate` workflow (this
codebase's only migration-authoring path) has no builder support for — introducing one would mean
hand-writing a migration outside that workflow for one narrow guarantee application code already
provides.

**Rationale**: Matches Principle XII's "prefer built-in... avoid a new mechanism for one feature" from
the other direction — the *simpler* choice here is not adding a constraint that would fight the existing
generate-from-schema workflow, given the invariant already holds by construction. A plain (non-unique)
index still exists for query performance (ordering by `position` on read).

**Accepted residual risk**: two concurrent create requests appending to the *same* course/module (e.g.
two admins both adding a module to the same course within milliseconds of each other) could both
compute the same `count(*)`-based append position and insert with a duplicate `position` value — each
request runs in its own transaction (this codebase's per-request transaction model,
`plugins/tenant-context.ts`), so there is no cross-request lock preventing it. This is accepted as
low-consequence (the two rows' *relative* order becomes arbitrary rather than deterministic; no error,
no data corruption, no crash) rather than engineered around with a row lock or `SERIALIZABLE`
isolation, since the spec sets no concurrency/consistency requirement stronger than this and the
duplicate-position case is self-healing on the next reorder (which always rewrites the full set to
`0..N-1` regardless of its starting values).

**Alternatives considered**:
- A `UNIQUE ... DEFERRABLE INITIALLY DEFERRED` constraint, hand-added to the generated migration —
  rejected: would be a first-of-its-kind deviation from "the schema file is the single source of truth,
  `db:generate` produces the migration" in this codebase, for defense-in-depth against a bug class
  (a reorder handler writing duplicate positions) that's already prevented by the handler always
  rewriting the *entire* set atomically in one transaction, never a partial update.
- A float/fractional position scheme (insert between 1.0 and 2.0 as 1.5, avoiding any renumbering) —
  rejected: solves a problem this spec doesn't have — direct-insert-at-position was explicitly rejected
  in favor of append-only-plus-reorder (Clarifications), so nothing ever needs to insert "between" two
  existing positions; every reorder already rewrites the full set anyway.

## 5. Cascade delete: `content_items.module_id` → `course_modules.id`, `ON DELETE CASCADE`

**Decision**: Deleting a module (spec FR-009) removes its content items via a plain FK
`ON DELETE CASCADE`, not an application-layer "delete children first" step.

**Rationale**: `ON DELETE CASCADE` is already an established convention in this schema (e.g.
`role_permissions.role_id → roles.id`, `form_field_order_overrides.form_field_id → form_fields.id`,
`super_admin_sessions.super_admin_id → super_admins.id`) — reusing it here is a direct continuation, not
a new pattern, and guarantees the cascade even if a future code path deletes a module through some other
route.

**Alternatives considered**:
- Application-layer cascade (fetch and delete every content item, then the module, in one transaction)
  — rejected: strictly more code for a guarantee the database already provides natively and this
  codebase already trusts elsewhere.

## 6. Move validation: target module must belong to the same course

**Decision**: When a content item update (FR-006) changes `module_id`, the route handler resolves the
target module via `request.tenantDb` (RLS already scopes it to the caller's tenant) and rejects (`422`)
if its `course_id` doesn't match the content item's own `course_id` — enforcing FR-008's "within the
same course" constraint at the application layer, since a cross-table `course_id` equality check isn't
expressible as a plain Postgres `CHECK` constraint (which cannot reference another row).

**Rationale**: Same reasoning as every other cross-reference validation in this codebase (e.g.
departments' manager/assistant-manager equality check, training-needs' department resolution) — a plain
`SELECT`-and-compare inside the existing per-request transaction.

**Alternatives considered**: None seriously — this is a two-row comparison, not a design decision with
real alternatives.

## 7. Routes: new `apps/api/src/course-content/tenant-course-content-routes.ts` plugin

**Decision**: One new Fastify plugin, registered in `server.ts` alongside `tenantCourseRoutes`, exposing
nine routes: create/update/delete/reorder modules (scoped under a course), create/update/delete/reorder
content items (scoped under a module), and one course-scoped curriculum read. No route lives inside
`tenant-course-routes.ts` itself — a new, clearly-bounded module for a clearly-bounded spec, matching
the one-plugin-per-feature-module convention.

**Rationale**: Continuation of the established per-module plugin pattern (`departments/`,
`training-needs/`, `courses/`).

**Alternatives considered**: Folding these routes into `tenant-course-routes.ts` — rejected: that file
already has six routes for `courses`/`course_categories`; adding eight more for two more entities would
make one file respons ible for four entities, worse for navigability with no compensating benefit.

## 8. Permissions: reuse `course.view`/`course.manage`, zero new permission keys

**Decision**: Every route in this spec is gated by `requireAnyPermission("course.view", "course.manage")`
for reads and `requirePermission("course.manage")` for writes — the exact same keys spec 023 already
seeded, granted, and backfilled. No migration adds a new permission row.

**Rationale**: Directly implements the Clarifications decision — module/content-item management is
treated as part of "managing a course," not a separate capability a tenant might want to grant
independently.

**Alternatives considered**: New `course_content.view`/`course_content.manage` keys — explicitly
rejected during spec clarification.

## 9. Testing: Vitest integration tests against real Postgres, mirroring `course-*.test.ts`

**Decision**: New behavior (module/content-item CRUD, reorder validation, cross-module move validation,
cascade delete, tenant isolation, permission gating) is covered by new files under
`apps/api/tests/integration/` (`course-content-*.test.ts`), run via the existing `vitest run` script.

**Rationale**: Direct continuation of spec 023's own testing convention, itself a continuation of every
prior RLS/permission-gated feature in this codebase.

**Alternatives considered**: None — established convention.

## 10. No web UI, no route in `apps/web`

**Decision**: This spec adds zero files under `apps/web`, matching spec 023's own explicit scope
boundary and this spec's own Constitution Alignment.

**Alternatives considered**: N/A — out of scope by explicit decision during spec scoping.
