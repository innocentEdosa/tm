# Implementation Plan: Course Creation

**Branch**: `023-course-creation` | **Date**: 2026-07-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/023-course-creation/spec.md`

## Summary

Add a tenant-scoped course catalog (`courses`) plus a tenant-extensible category taxonomy
(`course_categories`, seeded from six platform defaults) to `apps/api`, with CRUD-minus-delete API
endpoints (create, list with search/filter/pagination, get by id, update including free status
transitions, archive) gated by two new granular permissions, `course.view`/`course.manage`. No web UI
ships in this spec. The technical approach extends this codebase's already-established
department/training-needs pattern (shared-schema RLS, Fastify plugin per module, Drizzle schema +
migration sequence, `requirePermission`/`requireAnyPermission` preHandlers) rather than introducing
anything new — see research.md for each specific reuse decision.

## Technical Context

**Language/Version**: TypeScript 5.x / Node 20 (`.nvmrc`), matching every existing `apps/api` module.

**Primary Dependencies**: Fastify 5 (routing), Drizzle ORM 0.45 + drizzle-kit 0.31 (schema/migrations),
existing `request.tenantDb` (RLS-scoped Postgres client, `apps/api/src/plugins/tenant-context.ts`),
existing `requirePermission`/`requireAnyPermission` (`apps/api/src/permissions/require-permission.ts`),
existing `requireTenantUserSession` (`apps/api/src/tenant-auth/`).

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. Every
capability this spec needs (case-insensitive per-tenant uniqueness, upsert-on-conflict, pagination,
CHECK-constrained enums, RLS tenant isolation) is already covered by Postgres + Drizzle features this
codebase already uses elsewhere (research.md §1–§7) — no new npm package.

**Storage**: PostgreSQL (existing shared instance/schema) — three new tables
(`course_category_templates`, `course_categories`, `courses`), no new database.

**Testing**: Vitest (`pnpm --filter api test`), new integration test files under
`apps/api/tests/integration/course-*.test.ts` against a real Postgres connection — this codebase's
only existing testing convention for RLS/permission-gated behavior (research.md §9).

**Target Platform**: Linux server (existing `apps/api` Fastify deployment) — no platform change.

**Project Type**: Web application (existing Next.js frontend + Fastify backend monorepo). This spec
touches only the backend (`apps/api`) — no frontend changes.

**Performance Goals**: SC-002 — search/filter over a 500+-row tenant catalog with no perceptible delay;
met by the two new indexes (`courses_tenant_id_status_idx`, `courses_tenant_id_category_id_idx`,
data-model.md) plus RLS's existing per-tenant row scoping, at a scale two orders of magnitude below
where a plain `ILIKE` title search would need a dedicated trigram index (research.md — no new
extension).

**Constraints**: Tenant isolation enforced server-side on every row/query regardless of client input
(Constitution Principle I) — no constraint beyond what every existing tenant table already meets.

**Scale/Scope**: Tens to low hundreds of courses per tenant typically, explicitly designed to hold up
at 500+ (SC-002); five new API routes plus one categories-read route; three new tables; two new
permission keys; zero frontend routes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (Tenant Isolation)**: PASS. Both `courses` and `course_categories` carry `tenant_id`,
  RLS enabled + forced with the standard policy, identical migration sequence to every prior tenant
  table (research.md §2). `course_category_templates` is platform-global with no `tenant_id`, matching
  `department_templates`'/`permissions`' existing precedent for shared catalog data.
- **Principle II/III (Tenant-configurable, not fixed)**: PASS — this is the specific principle that
  drove the Clarifications decision to make category tenant-configurable-with-seeded-defaults rather
  than a fixed platform enum (spec Clarifications). Delivery mode/status/duration-unit remain fixed
  platform enums, justified in spec Constitution Alignment as structural/workflow states, not
  tenant-owned org taxonomy — same distinction already drawn for department's fixed fields.
- **Principle IV (Spec-Before-Code)**: PASS — this plan follows a ratified, clarified spec (5
  clarifying questions resolved) with no invented-in-code ambiguity remaining.
- **Principle V (Design system)**: N/A — no UI in this spec (spec Constitution Alignment).
- **Principle VI (Plan-tier aware)**: PASS by spec Assumptions — course catalog is core LMS
  functionality on all tiers, no tier-gating logic needed in this spec.
- **Principle VII (White-labeling)**: N/A — no branding/UI surface touched.
- **Principle VIII (Comprehensive-version rule)**: Applied once already during spec clarification (the
  category-taxonomy scope correction, flagged and resolved with the user rather than silently narrowed).
- **Principle IX (Demoable vs. internal)**: Stated explicitly in spec Constitution Alignment —
  internal/infrastructure-only, demoable via direct API calls (quickstart.md), not to a non-technical
  stakeholder until a follow-up UI spec exists.
- **Principle X (Clean branch)**: PASS — `023-course-creation` branched from a clean `master` working
  tree.
- **Principle XI (Fixed stack)**: PASS — Fastify backend, no new runtime/framework.
- **Principle XII/XIII (No new dependency)**: PASS — "None" per Technical Context above; every
  mechanism used already exists in this codebase or in Postgres itself.

No violations. Complexity Tracking table below is empty.

## Project Structure

### Documentation (this feature)

```text
specs/023-course-creation/
├── plan.md              # This file
├── research.md           # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/
│   └── course-management-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks — not created by this command)
```

### Source Code (repository root)

```text
apps/api/
├── src/
│   ├── db/schema/
│   │   ├── course-categories.ts        # NEW: course_category_templates, course_categories
│   │   └── courses.ts                  # NEW: courses
│   ├── courses/
│   │   └── tenant-course-routes.ts     # NEW: all routes from contracts/course-management-api.md
│   ├── provisioning/
│   │   └── provision-tenant.ts         # MODIFIED: call seedDefaultCourseCategoriesForTenant
│   └── server.ts                       # MODIFIED: register tenantCourseRoutes
├── drizzle/
│   ├── NNNN_course_tables.sql                          # NEW: schema (drizzle-kit generate)
│   ├── NNNN_rls_course_categories.sql                  # NEW
│   ├── NNNN_rls_courses.sql                            # NEW
│   ├── NNNN_lock_course_catalog_grants.sql             # NEW
│   ├── NNNN_seed_course_category_templates.sql         # NEW
│   ├── NNNN_seed_course_permissions.sql                # NEW
│   └── NNNN_backfill_course_categories_existing_tenants.sql  # NEW
└── tests/integration/
    ├── course-permission-gating.test.ts       # NEW
    ├── course-cross-tenant-isolation.test.ts  # NEW
    ├── course-category-auto-create.test.ts    # NEW
    ├── course-status-transitions.test.ts      # NEW
    └── course-archive-idempotent.test.ts      # NEW
```

**Structure Decision**: Follows the existing per-module plugin pattern exactly
(`apps/api/src/departments/tenant-department-routes.ts`, `apps/api/src/training-needs/
tenant-training-needs-routes.ts`) — a new `apps/api/src/courses/` directory for this feature's one
route plugin, new schema files under the existing `apps/api/src/db/schema/` directory (glob-discovered
by `drizzle.config.ts`, no registration step needed), and new migrations appended to the existing
numbered sequence in `apps/api/drizzle/`. No `apps/web` changes (spec is API-only). No new top-level
directory, package, or project.

## Complexity Tracking

*No Constitution Check violations — table intentionally empty.*
