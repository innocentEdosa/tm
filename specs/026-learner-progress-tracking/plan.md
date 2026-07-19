# Implementation Plan: Learner Progress & Attempt Tracking

**Branch**: `026-learner-progress-tracking` | **Date**: 2026-07-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/026-learner-progress-tracking/spec.md`

## Summary

Add a generic, tenant-scoped `learner_content_progress` entity to `apps/api` — one continuously-updated
current-state row per (tenant, user, content item), tracking status, an optional score, a resume
bookmark, accumulated time, and a SCORM-sized suspend-data blob. No enrollment gate: any `course.view`
holder can record their own progress; a learner can always read their own rows regardless of permission;
`course.view`/`course.manage` gates reading any other learner's progress. Four HTTP routes: record/update
own progress on a content item, read own progress on a content item, read own progress across a whole
course (curriculum-ordered), and review all learners' progress on a course (manager view). No new
dependency, no new permission keys, no UI — this is the second of two prerequisite specs (the first,
File Upload & Storage, shipped as spec 025) that unblock the SCORM 1.2 Runtime spec.

## Technical Context

**Language/Version**: TypeScript 5.x / Node 20, matching every existing `apps/api` module.

**Primary Dependencies**: Fastify 5, Drizzle ORM 0.45 + drizzle-kit 0.31, existing `request.tenantDb`,
`requirePermission`/`requireAnyPermission`, `requireTenantUserSession` — all already in place. Joins
against the existing `courseModules`/`contentItems` tables (spec 024) for curriculum-order reads.

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. This spec is
pure database schema + API surface on top of already-installed libraries — unlike spec 025, it
introduces no external service.

**Storage**: PostgreSQL (existing shared instance/schema) for the new `learner_content_progress` table —
one new table, no change to existing tables.

**Testing**: Vitest. Integration tests use real Postgres via `server.inject` (`tests/helpers/test-server`,
`tests/helpers/fixtures`), the same pattern as specs 023/024/025 — no external service to fake, so no new
test-fixture/recording pattern is needed here.

**Target Platform**: Linux server (existing `apps/api` Fastify deployment) — no platform change.

**Project Type**: Web application (existing Next.js + Fastify monorepo). This spec touches only the
backend (`apps/api`) — no frontend changes, matching specs 023/024/025's own scope pattern.

**Performance Goals**: Not a throughput-sensitive feature — each write is a single indexed
upsert-by-unique-key, each read is a single indexed lookup or a small indexed join against a course's
content items.

**Constraints**: Tenant isolation enforced server-side on every row regardless of client input
(Principle I). Self-access (read/write one's own row) is gated by row ownership, not by
`course.view`/`course.manage` (spec FR-010) — this is a distinct authorization path from every prior
spec in this sequence, which gated every operation purely by permission key.

**Scale/Scope**: Four new HTTP routes; one new table; zero new permission keys; zero frontend routes;
content items (spec 024) are the only progress subject wired in this spec.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (Tenant Isolation)**: PASS. `learner_content_progress` carries `tenant_id` directly, RLS
  enabled+forced with the standard hardened policy, identical migration sequence to every prior tenant
  table (research.md §1).
- **Principle II/III (Tenant-configurable, not fixed)**: PASS — no new permission keys; the status
  vocabulary is fixed platform-wide, consistent with the spec's own Constitution Alignment section.
- **Principle IV (Spec-Before-Code)**: PASS — this plan follows a ratified, `/speckit-clarify`'d spec
  (status-transition monotonicity and curriculum-read ordering both resolved before planning); no
  invented-in-code ambiguity remains.
- **Principle V (Design system)**: N/A — no UI in this spec.
- **Principle VI (Plan-tier aware)**: N/A — this spec carries no plan-tier gating of its own; progress
  tracking is core platform behavior, not a Growth/Enterprise-gated feature.
- **Principle VII (White-labeling)**: N/A — no branding/UI surface touched.
- **Principle VIII (Comprehensive-version rule)**: N/A — no scope-narrowing tradeoff arose during this
  spec's own scoping; the generic (all-6-content-types) field design was chosen over a SCORM-only-fields
  alternative precisely to avoid a narrower option (spec Assumptions).
- **Principle IX (Demoable vs. internal)**: Internal/infrastructure-only, stated explicitly in spec
  Constitution Alignment — demoable only via direct API calls (quickstart.md) until a learner-facing UI
  spec (the SCORM launcher) exists.
- **Principle X (Clean branch)**: PASS — `026-learner-progress-tracking` branched from `master` after
  spec 025 was fast-forward-merged in.
- **Principle XI (Fixed stack)**: PASS — Fastify backend, no new runtime/framework.
- **Principle XII/XIII (No new dependency without justification/sign-off)**: PASS — no new dependency
  introduced by this spec (see Technical Context).

No violations. Complexity Tracking table below is empty.

## Project Structure

### Documentation (this feature)

```text
specs/026-learner-progress-tracking/
├── plan.md               # This file
├── research.md            # Phase 0 output
├── data-model.md          # Phase 1 output
├── quickstart.md          # Phase 1 output
├── contracts/
│   └── learner-progress-api.md
└── tasks.md               # Phase 2 output (/speckit-tasks — not created by this command)
```

### Source Code (repository root)

```text
apps/api/
├── src/
│   ├── db/schema/
│   │   └── learner-content-progress.ts        # NEW: learner_content_progress
│   ├── progress/
│   │   ├── progress-validation.ts             # NEW: score-consistency + suspendData length checks
│   │   └── tenant-progress-routes.ts          # NEW: all 4 routes
│   └── server.ts                              # MODIFIED: register tenantProgressRoutes
├── drizzle/
│   ├── NNNN_learner_content_progress_table.sql # NEW: schema (drizzle-kit generate)
│   ├── NNNN_rls_learner_content_progress.sql   # NEW
│   └── NNNN_lock_learner_content_progress_grants.sql # NEW
└── tests/integration/
    ├── progress-record-own.test.ts             # NEW (US1)
    ├── progress-read-own.test.ts                # NEW (US2)
    └── progress-review-course.test.ts           # NEW (US3)
```

**Structure Decision**: One new top-level `apps/api/src/progress/` directory, following the
`courses/`/`course-content/`/`attachments/` per-feature-module convention already established. No new
adapter/test-seam module is needed (unlike `storage/` in spec 025) since this spec has no external
service dependency. No `apps/web` changes. No new top-level package or project.

## Complexity Tracking

*No Constitution Check violations — table intentionally empty.*
