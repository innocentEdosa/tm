# Implementation Plan: Training Needs Analysis (TNA)

**Branch**: `014-training-needs-analysis` | **Date**: 2026-07-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/014-training-needs-analysis/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

One new tenant-scoped table, `training_needs`, holds each department's training-need entries with a
deliberately minimal fixed field set (title, priority, department, status) plus the standard
`tenant_isolation` RLS policy already used by every other tenant table. Everything else a real client
actually wants to capture (Function, Type of Gap, Observable Incidences, Steps Taken, Performance
Expectation, Affected Job Roles, Recommended Training — confirmed against a real client TNA template
during clarification) is deliberately **not** hardcoded: it is registered as a new `training_needs_analysis`
row in the existing Custom Fields Framework's `form_definitions` (Spec 010), so HR/L&D Admins configure
it through the Settings > Forms screen that already exists — no new field-builder UI, no framework
change. Visibility and delete authorization reuse Team Directory's (Spec 012) department-hierarchy
scoping mechanism (`collectSubtreeIds`) verbatim rather than reimplementing it, with one addition this
spec introduces: Draft entries stay private to the authoring department and are excluded from the
`tna.view.all` (org-wide) scope entirely — enforced at the query layer (`WHERE status = 'submitted'`),
the same app-layer-not-RLS approach Team Directory already uses for department scoping. A new
"Learning" top-level sidebar section is added to `apps/web/app/(dashboard-shell)/layout.tsx` following
the exact same permission-gated `NavSection` pattern as "Administration". No new npm dependency.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 20, CommonJS output on the API side — unchanged, matches
every other backend feature in this repo.

**Primary Dependencies**: Fastify 5, Drizzle ORM (existing). Reused as-is: `request.tenantDb`,
`requirePermission`/`requireAnyPermission`, `requireTenantUserSession` (`apps/api/src/permissions/require-permission.ts`),
`collectSubtreeIds` (`apps/api/src/departments/department-hierarchy.ts`), and the Custom Fields
Framework's existing `GET/POST/PATCH /tenant/form-fields` and `GET/PUT /tenant/custom-field-values`
routes (`apps/api/src/custom-fields/tenant-form-routes.ts`) — TNA adds a `formKey` value to an
already-generic system, not new route code. Frontend: Next.js 15, React 19, `@tm/ui` (existing).

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. No new
package is needed anywhere in this feature.

**Storage**: PostgreSQL — Neon in production/staging, local Docker Postgres in development. One new
table (`training_needs`), shared-schema + RLS isolation model (constitution default, unchanged).

**Testing**: Vitest (existing dev dependency). Integration tests run against a real Postgres
connection via `apps/api/tests/helpers/test-server.ts` / `fixtures.ts`, mirroring the Department and
Team Directory integration-test convention (`fileParallelism: false` — these tests share one real DB,
no per-test rollback).

**Target Platform**: Linux server (Railway, existing Dockerfile/`railway.json`) — unchanged.

**Project Type**: Web application (existing pnpm/Turborepo monorepo `apps/api` + `apps/web`) — this
feature adds no new top-level project.

**Performance Goals**: No hard SLA specified. Working assumption, consistent with Spec 010's own
posture: rendering the create/edit form's merged field list and loading a department's own list add no
more than low-single-digit milliseconds via indexed queries, no N+1 across system vs. custom fields.

**Constraints**: A department-scoped Manager's Draft entries must never appear to a `tna.view.all`
holder under any query path — enforced in application code (`WHERE status = 'submitted'` when scope is
org-wide), not by RLS, since RLS enforces the tenant boundary only; status/department visibility is an
app-layer concern in this codebase already (Team Directory precedent). A Manager may delete only their
own Draft entries (never Submitted) — enforced as an explicit check in the `DELETE` route handler, not
a database constraint.

**Scale/Scope**: Tenant-scoped; on the order of tens to low hundreds of entries per tenant (the
reference template suggests 5–10 gaps per department across N departments). The org-wide HR list
(`tna.view.all`) uses server-side pagination like Team Directory's list; a single department's own
Manager-facing list stays unpaginated like Department's list, since it is bounded to one department's
entries.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Tenant isolation is a security requirement | **PASS** | `training_needs` gets the standard `tenant_isolation` RLS policy (`ENABLE`/`FORCE ROW LEVEL SECURITY`, `USING`/`WITH CHECK` on `tenant_id = current_setting('app.tenant_id', true)::uuid`), identical to `departments` (`0010_rls_departments.sql`). All routes go through `request.tenantDb`, never a raw pooled client. |
| II. Tenant provisioning includes org structure | N/A | No new department/role structure introduced; TNA references the existing `departments` table and existing `hr_admin`/`manager` role templates. |
| III. Forms and flows are tenant-configurable | **PASS** | This is the core design decision (see Summary). Fixed system fields are deliberately minimal (title, priority, department, status); every other data-collection field is tenant-configured via the existing Custom Fields Framework, per the spec's own Constitution Alignment section and Clarifications session. |
| IV. Spec-before-code | **PASS** | This plan follows a completed, clarified spec (`spec.md`, 3 resolved clarifications). |
| V. Design delegated to UI-UX-Pro-Max, then locked | **PASS** | The `@tm/ui` design system is already locked (Spec 008). TNA's list reuses existing `AppShell`/`NavSection`/list components verbatim. Create/edit is a dedicated full page rather than a `Drawer` (research.md §7, direct product feedback) — the first such form in this app — but reuses the same `.field-label`/`.field-input`/`Card`/`Button`/`Input` primitives, only introducing a two-column grid wrapper, not new component styling. |
| VI. Every module is plan-tier aware | **ASSUMPTION FLAGGED** | The spec does not call for plan-tier gating, and neither of TNA's two closest precedents (Department, Team Directory) are tier-gated. Working assumption: TNA ships as a core (all-tiers) feature like those two. Flagging per Principle VIII rather than silently deciding — confirm before implementation if this is wrong. |
| VII. White-labeling and structural customization go together | **PASS** | No new branding surface. TNA's only structural customization is its custom fields, which already follow the tenant-configurable mechanism Principle VII requires. |
| VIII. Comprehensive-version rule | **PASS** | Two scope-narrowing calls (no approval workflow, no cycles/campaigns) are recorded as explicit, flagged Assumptions in spec.md rather than silently decided. |
| IX. Demoable vs. internal work is explicit | **PASS** | Spec states this is stakeholder-demoable end-to-end. |
| X. Every feature starts in a clean-tree new branch | **NOTE** | `setup-plan.sh` reported an empty `BRANCH` (no `before_specify`/`before_plan` git hook is configured in this repo — `.specify/extensions.yml` does not exist). No branch has been created for this feature yet. Recommend creating `014-training-needs-analysis` from a clean `master` before `/speckit-implement` begins. |
| XI. Stack is fixed: Next.js + Fastify | **PASS** | No new framework/runtime. |
| XII. Prefer built-in/native utilities | **PASS** | Reuses existing `collectSubtreeIds`, existing Custom Fields Framework routes, existing permission middleware — no new utility needed. |
| XIII. No new package without permission | **PASS** | None requested; none needed. |

**Post-Phase 1 re-check**: Design artifacts (research.md, data-model.md, contracts/, quickstart.md)
introduced no new violation and no schema/RLS surface beyond what the table above already accounts
for — the single open item remains Principle VI's flagged plan-tier assumption, unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/014-training-needs-analysis/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── training-needs-api.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
apps/api/
├── drizzle/
│   ├── 0045_training_needs_table.sql              # CREATE TABLE training_needs
│   ├── 0046_rls_training_needs.sql                 # tenant_isolation RLS policy (mirrors 0010)
│   ├── 0047_seed_tna_form_definition.sql           # INSERT INTO form_definitions (key = 'training_needs_analysis')
│   ├── 0048_seed_tna_system_fields.sql             # INSERT INTO form_fields (is_system rows: title, priority, department, status) — mirrors 0036
│   └── 0049_seed_tna_permissions.sql               # tna.view.all / tna.view.department / tna.manage.all / tna.manage.department — mirrors 0040
├── src/
│   ├── db/schema/
│   │   └── training-needs.ts                       # new: trainingNeeds Drizzle table
│   ├── training-needs/
│   │   ├── tenant-training-needs-routes.ts          # new: plugin, mirrors tenant-department-routes.ts
│   │   └── training-need-visibility.ts              # new: resolveTrainingNeedVisibilityScope(), mirrors team-visibility.ts, reuses collectSubtreeIds
│   └── server.ts                                    # edited: register the new route plugin
└── tests/integration/
    ├── training-needs-permission-gating.test.ts     # new, mirrors department-permission-gating.test.ts
    ├── training-needs-visibility.test.ts             # new, mirrors team visibility tests
    └── custom-fields-tna-integration.test.ts         # new, mirrors custom-fields-department-integration.test.ts

apps/web/
└── app/(dashboard-shell)/
    ├── layout.tsx                                    # edited: new "Learning" NavSection, permission-gated
    └── learning/tna/
        ├── page.tsx                                  # new: server component (session/permission check), list only
        ├── training-needs-client.tsx                 # new: client component — list (Team Directory shape), row actions, delete confirmation
        ├── training-need-form.tsx                    # new: shared client form (full page, not a Drawer — research.md §7), two-column grid, used by both routes below
        ├── new/page.tsx                               # new: server component, create mode
        └── [id]/page.tsx                              # new: server component, edit mode (dynamic segment)
```

**Structure Decision**: Standard feature-module shape already used by Department (`apps/api/src/departments/`) and Team (`apps/api/src/tenant-auth/tenant-team-routes.ts`) — a dedicated `apps/api/src/training-needs/` module on the backend, and a route-scoped client component under `apps/web/app/(dashboard-shell)/learning/tna/` on the frontend, both registered into the existing app shells rather than introducing a new top-level app or package.

## Complexity Tracking

*No Constitution Check violations — this section is intentionally empty.*
