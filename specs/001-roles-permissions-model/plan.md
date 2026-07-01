# Implementation Plan: Roles & Permissions Model

**Branch**: `001-roles-permissions-model` | **Date**: 2026-07-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-roles-permissions-model/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Build the platform-wide permission catalog, default role templates (Super Admin, HR/L&D Admin,
Manager, Employee/Learner), and tenant-owned, tenant-configurable roles that reference it — enforced
server-side via Postgres Row-Level Security scoped per request through a transaction-local
`SET LOCAL app.tenant_id`, checked in Fastify via a `requirePermission` `preHandler` decorator. Data
access goes through Drizzle ORM bound to the existing `@fastify/postgres` connection pool (no second
Postgres client). Three new packages (`drizzle-orm`, `drizzle-kit`, `vitest`) were proposed, justified,
and approved by explicit user sign-off per constitution Principle XIII — nothing else is added.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 20 (per `.nvmrc`), CommonJS module output (matches
`packages/tsconfig/node.json`).

**Primary Dependencies**: Fastify 5, `@fastify/cors`, `@fastify/postgres` (already installed);
`pg` (already resolved as a peer dependency of `@fastify/postgres`, proposed to become an explicit
direct dependency of `apps/api` — not a new package, just an explicit declaration of what's already
resolved); Drizzle ORM (`drizzle-orm/node-postgres`) — new, see below.

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)* — **all approved by
explicit user sign-off, 2026-07-01**:
1. **`drizzle-orm`** (runtime dependency of `apps/api`) — **APPROVED**. Needed for type-safe schema
   definitions, query building, and generated SQL migrations for the permission/role tables. A
   built-in alternative (hand-written SQL via the existing `@fastify/postgres` pool) was considered and
   rejected: six interrelated tables with RLS policies and a tenant-provisioning seeding interface are
   meaningfully harder to keep correct and reviewable as hand-written SQL strings than as a typed
   schema with generated migrations. See research.md §1.
2. **`drizzle-kit`** (dev-only dependency of `apps/api`) — **APPROVED**. The CLI that generates SQL
   migration files from the Drizzle schema. No built-in Node/Fastify equivalent exists for this. See
   research.md §1.
3. **`vitest`** (dev-only dependency of `apps/api`) — **APPROVED**. Node's built-in `node:test` was
   proposed first as the zero-new-dependency option (Principle XII); the user explicitly chose Vitest
   instead for its watch mode/snapshot support on this frequently-re-run, security-critical test suite.
   See research.md §6.

   **Not requesting sign-off for `pg` itself** — it already resolves in the workspace as a peer
   dependency of `@fastify/postgres`; this plan only proposes declaring it explicitly in
   `apps/api/package.json`'s `dependencies`, which adds no new supply-chain surface.

   **Installs have not yet been run** — sign-off was captured during planning; `pnpm add` for these
   three packages is a `/speckit-tasks`/`/speckit-implement`-phase action, tracked as an explicit setup
   task.

**Storage**: PostgreSQL. Production/staging: Neon, via its pooled (`-pooler`) connection string in
transaction-pooling mode. Local development: the existing `docker-compose.yml` Postgres 16 container,
unchanged. See research.md §5 for pool-sizing rationale.

**Testing**: Vitest (approved new dev dependency; see research.md §6). Integration tests require a real
Postgres connection (local Docker Postgres or a disposable Neon branch) to exercise actual RLS
policies — permission-check logic cannot be verified as "actually blocked, not just assumed" (spec
SC-003/SC-004) using mocks.

**Target Platform**: Linux server (Railway, per existing `railway.json`/Dockerfile), long-running
Fastify process — explicitly not an edge/serverless runtime (per user-supplied tech context).

**Project Type**: Web-service (backend primitive) with one minimal Next.js admin UI surface (the
Super Admin read-only catalog/template view, spec FR-013) as the demoable slice.

**Performance Goals**: No hard SLA specified by the spec. Assumption: permission checks and effective-
permission resolution should add no more than low-single-digit milliseconds of query latency per
protected request, achievable via indexed joins on `role_permissions`/`user_roles` (see data-model.md);
this is a working assumption to be revisited once real traffic data exists, not a contractual target.

**Constraints**: Neon's per-tier connection ceiling (research.md §5) caps sustainable `pg.Pool` size;
RLS policies must fail closed when `app.tenant_id` is unset (research.md §2, verified in quickstart.md
§2); no client-supplied tenant/role/permission claim may ever influence an authorization decision
(constitution Principle I).

**Scale/Scope**: Assumption — initial rollout on the order of tens of tenants, each with on the order
of hundreds of users; not a hard limit, just the scale this design is sized against (conservative pool
size, no sharding/partitioning of the tenant-scoped tables at this stage).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Tenant isolation is a security requirement | **PASS** | RLS forced on every tenant-scoped table (`roles`, `role_permissions`, `user_roles`); tenant id comes only from the server-verified session via `SET LOCAL`, never from client input. Fails closed when unset (research.md §2). |
| II. Tenant provisioning includes org structure | **PASS (partial, by design)** | This spec is the prerequisite primitive; `seedDefaultRolesForTenant` (contracts/seed-default-roles-interface.md) is the exposed interface tenant-provisioning will call — provisioning itself is explicitly out of scope here. |
| III. Forms/flows are tenant-configurable | N/A | This feature has no forms/approval-flow schema; roles are the configurable primitive other flows will reference later. |
| IV. Spec-before-code | **PASS** | This plan follows the ratified spec.md; no ambiguity was invented in code — all defaults are recorded in research.md/data-model.md. |
| V. Design system (locked via UI-UX-Pro-Max) | **DEFERRED** | Design system not yet locked (per constitution). The one UI surface this feature touches (Super Admin catalog view) is flagged in Complexity Tracking below — its build-out must reference the design system once locked, or explicitly flag a design-system proposal, before implementation of that screen. |
| VI. Plan-tier awareness | N/A | Roles/permissions are core platform infrastructure available at every tier; no tier-gated capability is introduced by this feature itself. |
| VII. White-labeling & structural customization | **PASS** | Role names/descriptions/permission sets are fully tenant-runtime-configurable (FR-006); nothing here hardcodes tenant-specific structure into shared code. |
| VIII. Comprehensive-version rule | **PASS** | Multi-role-per-user (union of permissions) chosen as the more complete option, as already flagged in spec.md Assumptions for sign-off. |
| IX. Demoable vs. internal | **PASS** | Explicitly stated in Technical Context and Project Type: primarily internal/infrastructure, with the Super Admin catalog view as the demoable slice. |
| X. Clean branch per feature | **PASS** | No git repository is initialized in this workspace yet (environment has no `.git`); this plan does not stack onto any other unmerged feature. Flagged as a pre-implementation housekeeping item, not a plan-time violation. |
| XI. Stack is fixed (Next.js/Fastify) | **PASS** | Plan uses only Fastify (backend) and proposes one Next.js screen (frontend); no alternative framework introduced. |
| XII. Prefer built-in/native utilities | **PASS** | Node's built-in `node:test` was proposed first (research.md §6) and only superseded by explicit user choice of Vitest; Drizzle reuses the existing `pg` pool rather than adding a second driver. |
| XIII. No new package without explicit permission | **PASS — sign-off obtained 2026-07-01** | `drizzle-orm`, `drizzle-kit`, and `vitest` were each stated with justification and explicitly approved by the user before this plan was finalized. No install has been run yet — that happens in `/speckit-tasks`/`/speckit-implement`. |

No unresolved [NEEDS CLARIFICATION] markers remain in Technical Context. All dependency sign-offs
required by Principle XIII were obtained during planning (see New Dependencies above).

## Project Structure

### Documentation (this feature)

```text
specs/001-roles-permissions-model/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── super-admin-catalog-api.md
│   └── seed-default-roles-interface.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

This is the existing pnpm/Turborepo monorepo (Option 2: web application, already in place — no new
top-level projects introduced):

```text
apps/api/                        # Fastify backend (existing)
├── src/
│   ├── server.ts                 # existing — gains tenant-context plugin registration
│   ├── db/
│   │   ├── client.ts              # new — drizzle(fastify.pg.pool) wiring
│   │   └── schema/                 # new — Drizzle schema files
│   │       ├── permissions.ts
│   │       ├── role-templates.ts
│   │       └── roles.ts            # roles, role_permissions, user_roles
│   ├── plugins/
│   │   └── tenant-context.ts       # new — SET LOCAL app.tenant_id transaction plugin (research.md §3)
│   └── permissions/
│       ├── require-permission.ts   # new — requirePermission() preHandler factory
│       ├── seed-default-roles.ts   # new — seedDefaultRolesForTenant (contracts/seed-default-roles-interface.md)
│       └── admin-routes.ts         # new — GET /admin/permissions, /admin/role-templates
└── drizzle/                        # new — generated SQL migrations (drizzle-kit approved 2026-07-01)

apps/web/                         # Next.js frontend (existing)
└── app/
    └── admin/
        └── permissions/             # new — minimal Super Admin read-only catalog view (demoable slice)

packages/types/src/index.ts       # existing — reused as-is; no new shared types required for this
                                   # feature's contracts (see contracts/super-admin-catalog-api.md)
```

**Structure Decision**: Extend the existing `apps/api` and `apps/web` apps in place — this feature adds
no new top-level package or service. Backend logic (schema, tenant-context plugin, permission
enforcement, seeding interface) lives under `apps/api/src/{db,plugins,permissions}/`; the one UI
surface (Super Admin catalog view) lives under the existing `apps/web/app/` routing convention.

## Complexity Tracking

> One item remains open here — a governance gate, not a constitution violation — that must clear
> before implementation of the affected work in `/speckit-tasks`/`/speckit-implement`. The dependency
> sign-off item (Principle XIII) was resolved during planning and is recorded for traceability, not as
> a blocker.

| Item | Why Needed | Simpler Alternative Rejected Because | Status |
|------|------------|---------------------------------------|--------|
| Add `drizzle-orm` + `drizzle-kit` + `vitest` as new dependencies | Type-safe schema/migrations/RLS-aware queries (research.md §1) for 6 interrelated tables, plus a test runner with watch/snapshot support for a frequently-re-run, security-critical suite (research.md §6) | Hand-written raw SQL and Node's built-in `node:test` were both proposed as zero-new-dependency defaults per Principle XII; the user explicitly chose Drizzle + Vitest instead when asked to sign off | **Resolved 2026-07-01 — approved** |
| Build the Super Admin catalog view (`apps/web/app/admin/permissions/`) before the design system is locked | Spec FR-013 requires a demoable slice for this milestone | Deferring the whole feature until the design system locks was considered; rejected because the backend primitive (catalog, roles, enforcement) has no such dependency and can proceed now — only this one screen's visual build-out should wait for or explicitly flag against the design system, per constitution Principle V | **Open — flag at implementation time of that screen** |
