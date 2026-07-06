# Implementation Plan: Department Management

**Branch**: `009-department-management` | **Date**: 2026-07-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-department-management/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Extend the existing flat, tenant-owned `departments` table (created by Spec 002's tenant-provisioning
feature, deliberately non-hierarchical at the time) with a self-referencing `parent_department_id`
(max 3 levels deep, cycle-free), a `description`, and a `status` (`active`/`archived`) column, and
build the full view/create/edit/delete/archive UI and API around it — gated by two new catalog
permissions (`department.view`, `department.manage`) following the exact `requirePermission` +
tenant-scoped-transaction pattern Spec 001 established. A `department_id` column is added to `users`
(currently absent) so member counts and the deletion-blocking rule have real data to read, with a
minimal, justified touch to the existing (deliberately bare) "add team member" form to let that column
actually be set. Hierarchy invariants (no cycles, no cross-tenant parent, depth ≤ 3) are enforced in
the application layer inside the same RLS-scoped transaction as every other write, not via a new
database trigger mechanism — this codebase has no trigger precedent yet, and a straightforward
recursive-CTE ancestor check achieves the same guarantee with less net-new surface. A department also
gains an optional Manager and Assistant Manager, each any user in the tenant (not restricted to that
department's own members) — two nullable, mutually-`SET NULL` FKs to `users`, plus the smallest
possible new endpoint (`GET /tenant/users?search=`) to make "any tenant user" pickable at all, since no
user-listing capability exists in this codebase yet. No new npm dependency is required.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 20, CommonJS output — unchanged, matches every other
backend feature in this repo (`packages/tsconfig/node.json`).

**Primary Dependencies**: Fastify 5 (existing), Drizzle ORM `drizzle-orm/node-postgres` (existing,
approved in Spec 001), `request.tenantDb` / `requirePermission` / `requireTenantUserSession`
infrastructure (existing, reused as-is — see research.md §1). `@tm/ui` (existing package) gains one
new reusable primitive, `Modal` (see research.md §6).

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. This feature
is built entirely on infrastructure already installed and approved (Drizzle, Vitest, Fastify,
Next.js) — no new package of any kind is needed. The department hierarchy is a self-referencing
foreign key plus application-layer recursive queries (native `WITH RECURSIVE` SQL via Drizzle's `sql`
tag, no new query-building library), and the new `Modal` UI primitive is plain React + the existing
Tailwind design system, not a component library.

**Storage**: PostgreSQL — Neon in production/staging, the existing local Docker Postgres 16 container
in development. Same connection/pooling model as every other tenant-scoped table (Spec 001
research.md §2, reused unchanged).

**Testing**: Vitest (existing dev dependency). Integration tests run against a real Postgres
connection (local Docker or a disposable Neon branch), mirroring every existing RLS-dependent
integration test in `apps/api/tests/integration/` (e.g. `rls-cross-tenant.test.ts`,
`tenant-role-delete-blocked.test.ts`) — hierarchy/cycle/cross-tenant-parent enforcement cannot be
verified as "actually blocked" using mocks. No frontend test framework exists in this repo yet
(unchanged by this feature); the Department UI is validated via the manual flows in quickstart.md,
consistent with every other `apps/web` screen shipped so far.

**Target Platform**: Linux server (Railway, existing Dockerfile/`railway.json`), long-running Fastify
process — unchanged.

**Project Type**: Web application (existing pnpm/Turborepo monorepo: `apps/api` + `apps/web` +
`packages/ui`) — this feature adds no new top-level project.

**Performance Goals**: No hard SLA specified by the spec. Working assumption (consistent with Spec
001's precedent): department-tree queries (list + search + member counts) should stay well under
100ms server-side at the expected scale (below), achievable via an indexed `(tenant_id,
parent_department_id)` lookup and a single recursive CTE per request rather than N+1 queries per
tree level.

**Constraints**: The 3-level depth cap and cycle-freedom are structural invariants that must hold
regardless of client input (constitution Principle I) — enforced via a server-side ancestor-chain
check inside the same transaction as the write, not trusted to the UI's picker-exclusion logic alone.
A department's parent must never resolve cross-tenant, even via direct API call — enforced by scoping
the ancestor lookup itself through `request.tenantDb` (RLS-scoped), so a cross-tenant id simply cannot
be found, exactly like every existing cross-tenant-reference check in this codebase.

**Scale/Scope**: Assumption, consistent with a 3-level-deep org chart: on the order of tens to low
hundreds of departments per tenant, not thousands — sized for a hand-rolled `<table>` UI with
client-side tree expand/collapse (no virtualization, no pagination), matching the existing
`admin/permissions/page.tsx` table pattern rather than introducing a new generic Table/virtualized-list
primitive.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Tenant isolation is a security requirement | **PASS** | RLS already forced on `departments` (existing, Spec 002); new `parent_department_id` self-reference and the new `users.department_id` are both resolved only through `request.tenantDb`, so a cross-tenant id is simply invisible, never a runtime "check and reject" that a bug could skip. |
| II. Tenant provisioning includes org structure | **PASS** | This spec is exactly the "rename, add, remove, restructure departments... without a code change" capability Principle II requires; existing default-department seeding (Spec 002) is untouched — new columns are nullable/defaulted, so seeded departments remain valid rows with no backfill needed. |
| III. Forms/flows are tenant-configurable | N/A | No approval-flow or intake-form schema is touched by this feature. |
| IV. Spec-before-code | **PASS** | This plan follows the ratified, clarified spec.md; the one real ambiguity discovered during planning (see research.md §2 — the "Members list" the spec's Assumptions assumed exists is actually just a bare create form) is resolved here with a documented, minimal-scope decision, not invented silently in code. |
| V. Design system (UI-UX-Pro-Max, locked) | **PASS** | Reuses the locked Desktop Shell Visual Language design system in full — Card/Badge/PageHeader components, `.field-input`/`.btn` classes, sentence-case copy, blue accent only. One new primitive (`Modal`) is built to the same system, not a new style. |
| VI. Plan-tier awareness | N/A | Department management is core organizational structure, available at every tier — not a tier-gated capability (spec Constitution Alignment). |
| VII. White-labeling & structural customization | **PASS** | Department names/hierarchy/descriptions/status are fully tenant-runtime-configurable; nothing tenant-specific is hardcoded into shared code. |
| VIII. Comprehensive-version rule | **PASS** | The "reassign members before deleting" shortcut is flagged, not silently downgraded — research.md §2 documents exactly why a full reassignment UI is out of scope here (it belongs to the not-yet-built Team Directory spec) and what the interim, honest behavior is. |
| IX. Demoable vs. internal | **PASS** | Fully demoable: a real UI flow (view/search/create/edit/archive/delete a department tree) with visible screens at every step. |
| X. Clean branch per feature | **PASS** | Branch `009-department-management` was created from a clean, up-to-date `master` (all prior work merged first). |
| XI. Stack is fixed (Next.js/Fastify) | **PASS** | Only Fastify (backend routes) and Next.js (frontend screens) are used; no alternative framework introduced. |
| XII. Prefer built-in/native utilities | **PASS** | Hierarchy enforcement uses a plain recursive SQL query, not a new graph/tree library; the new `Modal` primitive is hand-built React, not a component-library dependency. |
| XIII. No new package without explicit permission | **PASS — N/A, none requested** | Zero new npm packages are needed for this feature (see Technical Context). |

No unresolved `[NEEDS CLARIFICATION]` markers remain in Technical Context.

## Project Structure

### Documentation (this feature)

```text
specs/009-department-management/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
│   └── department-management-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

Existing pnpm/Turborepo monorepo — no new top-level project. Extends `apps/api`, `apps/web`, and
`packages/ui` in place:

```text
apps/api/
├── src/
│   ├── db/schema/
│   │   ├── departments.ts          # existing — gains parentDepartmentId, description, status,
│   │   │                           #            managerId, assistantManagerId (both FK → users.id)
│   │   └── users.ts                # existing — gains departmentId (nullable FK) — mutually
│   │                                #            referencing with departments.ts (research.md §9)
│   └── departments/                # new module, mirrors src/permissions/ and src/tenant-auth/
│       ├── department-hierarchy.ts  # new — ancestor-chain/cycle/depth-cap check (research.md §3)
│       ├── tenant-department-routes.ts  # new — list/search+tree, create, edit, delete, archive,
│       │                                #      plus GET /tenant/users?search= (research.md §10)
│       └── (reuses existing require-permission.ts, requireTenantUserSession, request.tenantDb)
├── drizzle/                          # new migrations appended (schema alter + RLS re-check + seed
│                                      # of department.view/department.manage permissions)
└── tests/integration/
    ├── department-hierarchy-cycle-blocked.test.ts     # new
    ├── department-cross-tenant-parent-blocked.test.ts # new
    ├── department-delete-blocked-members.test.ts      # new
    ├── department-delete-blocked-children.test.ts     # new
    ├── department-archive-alternative.test.ts         # new
    └── department-permission-gating.test.ts           # new

apps/web/
└── app/(dashboard-shell)/settings/department/
    ├── page.tsx                     # new — Server Component, session + permission gate (mirrors
    │                                #        settings/team/page.tsx and settings/authentication/page.tsx)
    └── department-settings-client.tsx  # new — list/search/tree/create/edit/delete/archive UI,
                                       #        incl. Manager/Assistant Manager pickers
    (dashboard-shell)/layout.tsx      # existing — "Department" nav entry (already scaffolded,
                                       #            disabled/"Soon") flips to enabled, gated by
                                       #            department.view / department.manage
apps/web/app/(dashboard-shell)/settings/team/
├── page.tsx                          # existing — unchanged
└── team-settings-client.tsx          # existing — gains one optional "Department" field on the
                                       #            add-team-member form (research.md §2)

packages/ui/src/
├── modal.tsx                         # new — minimal reusable dialog primitive (research.md §6)
└── index.ts                          # existing — export Modal
```

**Structure Decision**: Extend `apps/api`, `apps/web`, and `packages/ui` in place, following the exact
module/route/page conventions already established by Specs 001–008 (`src/{feature}/` for backend
modules, `app/(dashboard-shell)/settings/{feature}/` for tenant-settings screens). No new package, no
new service, no new top-level directory.

## Complexity Tracking

> No constitution violations require justification. The items below are scope-boundary judgment
> calls surfaced during planning, recorded here for traceability rather than left implicit in code.

| Item | Why Needed | Simpler Alternative Rejected Because | Status |
|------|------------|---------------------------------------|--------|
| Add `departmentId` to `users` + one optional field on the existing add-team-member form | Spec FR-008/015/016 require real per-department member counts and a deletion-block that reflects actual assignments — without *some* way to set `department_id`, that whole safety mechanism would be permanently vacuous (always zero members, delete never blocked) | Building nothing and leaving member-count/deletion-blocking untestable was rejected as incomplete against the ratified spec; building a *new* full Team Directory/member-edit UI was rejected as out-of-scope creep into a separate, not-yet-built spec — the minimal middle ground (one field on the one existing entry point) is the smallest change that makes the feature real | Resolved — see research.md §2 |
| Add `GET /tenant/users?search=` (new, minimal endpoint) | Spec FR-019 requires the Manager/Assistant Manager pickers to search *any* tenant user — no user-listing/search capability exists anywhere in this codebase yet, only user creation | Restricting the picker to only members already assigned to that department (servable from existing department data, no new endpoint) was rejected in Clarifications (2026-07-06) as the less useful option; building a full Team Directory user-list feature was rejected as out-of-scope creep — the endpoint returns only `id`/`fullName`/`email`, requires a non-empty search, and is gated by the existing `department.manage` permission rather than a new one | Resolved — see research.md §10 |
| `departments.ts` and `users.ts` schema files become mutually referencing (`departments.manager_id`/`assistant_manager_id` → `users.id`, `users.department_id` → `departments.id`) | Both directions of the relationship are real and independently needed (a member's home department; a department's manager, who need not be that department's own member) | Avoiding the circularity via a join table was considered and rejected — Drizzle's existing lazy `.references(() => ...)` pattern (already used elsewhere in this schema) handles mutual references safely with no new mechanism, so there was no actual problem to work around, just a fact worth recording | Resolved — see research.md §9 |
| Deletion-blocked message's "shortcut into the Members list" links to the existing bare `/settings/team` page, which has no list or filter yet | The spec's exact wording ("Members list filtered by that department") assumes a list view that doesn't exist yet — only a create form does | Building a filtered member list here was rejected as Team Directory's scope (a separate, larger, not-yet-built spec); silently changing the spec's wording without flagging it was rejected per Principle VIII | Flagged, not silently downgraded — see research.md §2 |
