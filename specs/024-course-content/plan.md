# Implementation Plan: Course Content

**Branch**: `024-course-content` | **Date**: 2026-07-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/024-course-content/spec.md`

## Summary

Add curriculum authoring to the Course Creation spec's `courses` entity: a new `course_modules` table
(ordered sections within a course) and a new polymorphic `content_items` table (ordered within a
module, six fixed types — video/article/live_class/test/assignment/external_import — via a `type`
discriminator + `jsonb` payload). Nine new API endpoints (module CRUD + reorder, content-item CRUD +
reorder, one course-scoped curriculum read) reuse spec 023's existing `course.view`/`course.manage`
permissions — no new permission keys. Placement is append-only on create/move; a dedicated reorder
action (submitting the complete ordered id set) is the only way to place anything but last. No web UI,
no file upload, no SCORM runtime, no learner-progress tracking — all four explicitly deferred and
encoded as non-goals in the spec's own FRs, not just prose.

## Technical Context

**Language/Version**: TypeScript 5.x / Node 20, matching every existing `apps/api` module (unchanged
from spec 023).

**Primary Dependencies**: Fastify 5, Drizzle ORM 0.45 + drizzle-kit 0.31, existing `request.tenantDb`,
`requirePermission`/`requireAnyPermission`, `requireTenantUserSession` — all already in place from
spec 023, no new library.

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. `jsonb` for
the polymorphic `payload` column is a native Postgres/Drizzle column type already used elsewhere in
this schema (`custom_field_values.value`, `form_fields.options` — research.md §3); `ON DELETE CASCADE`
is likewise an already-used FK action (research.md §5). No new npm package.

**Storage**: PostgreSQL (existing shared instance/schema) — two new tables (`course_modules`,
`content_items`), no new database, no change to spec 023's tables.

**Testing**: Vitest, new integration test files under
`apps/api/tests/integration/course-content-*.test.ts` against a real Postgres connection, mirroring
spec 023's own `course-*.test.ts` convention (research.md §9).

**Target Platform**: Linux server (existing `apps/api` Fastify deployment) — no platform change.

**Project Type**: Web application (existing Next.js + Fastify monorepo). This spec touches only the
backend (`apps/api`) — no frontend changes, matching spec 023's own scope pattern.

**Performance Goals**: SC-005 — a 20-module × 10-item curriculum (200 content-item rows) returns with
no perceptible delay; met by two flat, indexed `course_id`-scoped queries (research.md §1) instead of a
join, at a scale two orders of magnitude below where that would matter.

**Constraints**: Tenant isolation enforced server-side on every row regardless of client input
(Principle I) — no constraint beyond what spec 023's own tables already meet. Ordering/position is
entirely server-computed, never client-supplied (spec Clarifications, research.md §4).

**Scale/Scope**: Nine new API routes; two new tables; zero new permission keys; zero frontend routes;
typically tens of modules/content items per course, explicitly designed to hold up at 200+ (SC-005).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (Tenant Isolation)**: PASS. Both new tables carry `tenant_id` directly, RLS
  enabled+forced with the standard policy, identical migration sequence to every prior tenant table
  (research.md §2).
- **Principle II/III (Tenant-configurable, not fixed)**: PASS — no new permission keys, no new
  tenant-configurable taxonomy introduced. The `type` enum is fixed platform-wide, matching the same
  structural-not-organizational reasoning spec 023 already applied to delivery mode/status.
- **Principle IV (Spec-Before-Code)**: PASS — this plan follows a ratified, clarified spec (8
  clarifying questions total across drafting and `/speckit-clarify`) with no invented-in-code ambiguity
  remaining.
- **Principle V (Design system)**: N/A — no UI in this spec.
- **Principle VI (Plan-tier aware)**: PASS by inheritance — course content sits under the same core-LMS
  course catalog spec 023 already placed on all tiers; no new tier-gating logic needed.
- **Principle VII (White-labeling)**: N/A — no branding/UI surface touched.
- **Principle VIII (Comprehensive-version rule)**: Applied during spec scoping — the user explicitly
  chose the comprehensive six-content-type option over a narrower core-only alternative, and that choice
  is honored, not silently trimmed, while still flagging the genuinely-deferred pieces (file upload,
  SCORM runtime, grading, progress tracking) explicitly rather than silently implying them as included.
- **Principle IX (Demoable vs. internal)**: Internal/infrastructure-only, stated explicitly in spec
  Constitution Alignment — demoable only via direct API calls (quickstart.md) until a follow-up UI spec
  exists.
- **Principle X (Clean branch)**: PASS — `024-course-content` branched from a clean `master` (the
  023 branch was committed and merged before this one started).
- **Principle XI (Fixed stack)**: PASS — Fastify backend, no new runtime/framework.
- **Principle XII/XIII (No new dependency)**: PASS — "None" per Technical Context; `jsonb` and
  `ON DELETE CASCADE` both reuse existing, already-adopted Postgres/Drizzle features.

No violations. Complexity Tracking table below is empty.

## Project Structure

### Documentation (this feature)

```text
specs/024-course-content/
├── plan.md              # This file
├── research.md           # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/
│   └── course-content-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks — not created by this command)
```

### Source Code (repository root)

```text
apps/api/
├── src/
│   ├── db/schema/
│   │   └── course-content.ts                    # NEW: course_modules, content_items
│   ├── course-content/
│   │   ├── tenant-course-content-routes.ts       # NEW: all 9 routes from contracts/course-content-api.md
│   │   └── content-item-payload-validation.ts    # NEW: per-type payload validation (research.md §3)
│   └── server.ts                                 # MODIFIED: register tenantCourseContentRoutes
├── drizzle/
│   ├── NNNN_course_content_tables.sql             # NEW: schema (drizzle-kit generate)
│   ├── NNNN_rls_course_modules.sql                # NEW
│   ├── NNNN_rls_content_items.sql                 # NEW
│   └── NNNN_lock_course_content_grants.sql        # NEW
└── tests/integration/
    ├── course-content-modules.test.ts                    # NEW (US1)
    ├── course-content-items.test.ts                      # NEW (US2)
    ├── course-content-curriculum-read.test.ts            # NEW (US3)
    ├── course-content-edit-reorder-move.test.ts          # NEW (US4)
    ├── course-content-delete-cascade.test.ts             # NEW (US5)
    └── course-content-permission-tenant-isolation.test.ts  # NEW (cross-cutting sweep, Polish)
```

**Structure Decision**: Follows the exact pattern spec 023 established for itself
(`apps/api/src/courses/tenant-course-routes.ts`) — a new `apps/api/src/course-content/` directory for
this feature's route plugin (kept separate from `courses/` per research.md §7), a new schema file under
the existing `apps/api/src/db/schema/` directory (glob-discovered, no registration step), and new
migrations appended to the existing numbered sequence. No `apps/web` changes. No new top-level
directory, package, or project. Unlike spec 023 (which needed its own permission-seeding migration for
two new keys), this spec needs **no permission-seeding migration at all** — only schema, RLS, and
grants migrations, since it reuses spec 023's `course.view`/`course.manage` unchanged.

## Complexity Tracking

*No Constitution Check violations — table intentionally empty.*
