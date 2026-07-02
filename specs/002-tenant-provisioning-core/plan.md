# Implementation Plan: Tenant Provisioning Core

**Branch**: `002-tenant-provisioning-core` | **Date**: 2026-07-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-tenant-provisioning-core/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Build the sales-assisted tenant-onboarding flow as one atomic Fastify endpoint,
`POST /provisioning/tenants`: generates a new `tenant_id`, creates the `tenants` row (Trial status
only), seeds default departments (customizable in the same request), creates the initial admin
`users` row, and assigns it the `hr_admin`-sourced role via Spec 1's existing
`seedDefaultRolesForTenant`. Tenant isolation is bootstrapped by generating the tenant's UUID in
application code and setting `app.tenant_id` to it *before* any insert, reusing Spec 1's
`SET LOCAL`/RLS idiom rather than introducing a new elevated database role. No new dependencies —
this extends the existing Fastify/Drizzle/Postgres stack Spec 1 already shipped.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 20 (per `.nvmrc`), matching `apps/api`'s existing
`packages/tsconfig/node.json` config — unchanged from Spec 1.

**Primary Dependencies**: Fastify 5, `@fastify/cors`, `@fastify/postgres`, `drizzle-orm`, `pg` — all
already installed and used identically to Spec 1's implementation (verified directly against
`apps/api/src/`, not just its plan). `apps/web`'s Next.js app, unchanged.

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. This feature
reuses every piece of already-installed infrastructure Spec 1 set up (Drizzle schema/migrations,
Fastify routing, Vitest, the `pg` pool). See research.md §8.

**Storage**: PostgreSQL — the same database Spec 1's tables live in (shared schema + RLS). Local dev:
existing `docker-compose.yml` Postgres 16 container. Production/staging: Neon, unchanged from Spec 1.

**Testing**: Vitest, matching Spec 1's `apps/api/tests/integration/` convention — integration tests
require a real Postgres connection (no mocks), since RLS enforcement and transaction
atomicity/rollback (FR-013) cannot be verified as "actually blocked/rolled back" against a mock. See
quickstart.md.

**Target Platform**: Linux server (Railway), long-running Fastify process — unchanged from Spec 1.

**Project Type**: Web-service (backend primitive: one new endpoint + four new/amended tables) with
one new Next.js screen (the provisioning wizard) as this feature's demoable slice.

**Performance Goals**: No hard SLA specified by the spec. SC-001 (full provisioning in under 10
minutes) is a human-in-the-loop UX target, not a request-latency target; the endpoint itself is a
single transaction with roughly a dozen inserts and is expected to complete in well under a second
under normal conditions — a working assumption, not a contractual target, consistent with Spec 1's
plan.md precedent.

**Constraints**: Every insert in the provisioning transaction MUST occur only after `app.tenant_id`
is set to the newly generated `tenant_id` (research.md §1) — a code-review-enforced ordering
constraint, since nothing else prevents an insert running before that `SET LOCAL`, and RLS would then
reject it (fail closed, matching Spec 1's precedent). Subdomain uniqueness MUST be enforced only via
the DB unique constraint, never a pre-read (research.md §2).

**Scale/Scope**: Same working assumption as Spec 1 — tens of tenants at initial rollout, not a hard
limit. One new endpoint, four new tables (`tenants`, `department_templates`, `departments`, `users`).
No schema change to `user_roles` — a FK to `users.id` was attempted and reverted (research.md §6:
would have blocked Spec 1's platform Super Admin role assignment).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Tenant isolation is a security requirement | **PASS** | Every new tenant-scoped table (`tenants`, `departments`, `users`) gets RLS enabled + forced, identical policy shape to Spec 1's `roles`/`user_roles`. `tenant_id` is generated server-side in application code and never accepted from client input (research.md §1). |
| II. Tenant provisioning includes org structure | **PASS** | This is the spec Principle II was written for: department templates are seeded by default and freely renamable/addable/removable in the same request (FR-006, FR-007), no code change required to restructure a tenant's departments. |
| III. Forms/flows are tenant-configurable | N/A | This feature has no approval-flow schema; the one "form" (the provisioning request itself) is a platform-internal, sales-assisted intake, not a tenant-facing configurable form. |
| IV. Spec-before-code | **PASS** | This plan follows the ratified, clarified spec.md; the three clarification decisions (sales-assisted; single-admin-only; primary contact as plain `tenants` fields) are already recorded in spec.md's Clarifications section and threaded through this plan/data model, not invented here. |
| V. Design system (locked via UI-UX-Pro-Max) | **DEFERRED** | Still not locked (unchanged since Spec 1). The one new UI surface (provisioning wizard) explicitly follows the same "pending a fully locked design system" flag already used verbatim by `apps/web/app/admin/permissions/page.tsx` — tracked in Complexity Tracking below. |
| VI. Plan-tier awareness | N/A | FR-012 explicitly excludes plan-tier/feature-flag/usage-limit logic from this spec; `tenants.status` carries only Trial through every code path this plan defines. |
| VII. White-labeling & structural customization | **PASS** | Department names/structure are fully tenant-runtime-configurable at provisioning (FR-007) and not hardcoded into shared code; no branding logic is touched (Spec 4's scope). |
| VIII. Comprehensive-version rule | N/A | No conflicting-scope tradeoff surfaced during planning; the single-request/single-transaction design (research.md §3) is the more complete option relative to a partial, non-atomic alternative, not the smaller one. |
| IX. Demoable vs. internal | **PASS** | Explicitly stated in spec.md Constitution Alignment and reaffirmed here: the full flow (company details → departments → admin → landing on a Trial tenant) is the demoable slice; unchanged by this plan. |
| X. Clean branch per feature | **PASS** | Branch `002-tenant-provisioning-core` was created from a clean `master` before any spec work began (see spec.md provenance); this plan does not stack onto any other unmerged feature. |
| XI. Stack is fixed (Next.js/Fastify) | **PASS** | Extends the existing `apps/api` (Fastify) and `apps/web` (Next.js) apps in place; no alternative framework introduced. |
| XII. Prefer built-in/native utilities | **PASS** | The tenant-bootstrapping problem (research.md §1) and subdomain-uniqueness problem (research.md §2) are both solved by reusing Postgres's own RLS/unique-constraint machinery and Spec 1's existing `SET LOCAL` idiom, rather than introducing a new Postgres role, a saga library, or a new ORM feature. |
| XIII. No new package without explicit permission | **PASS — nothing to approve** | No new dependency is proposed (research.md §8); Technical Context states "None" per Principle XIII's own template instruction. |

No unresolved `[NEEDS CLARIFICATION]` markers remain in Technical Context. Spec-level clarifications
were fully resolved in `/speckit-clarify` before this plan was written.

## Project Structure

### Documentation (this feature)

```text
specs/002-tenant-provisioning-core/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── provision-tenant-api.md
│   └── seed-default-departments-interface.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

Existing pnpm/Turborepo monorepo (unchanged top-level structure from Spec 1 — no new app/package):

```text
apps/api/
├── src/
│   ├── db/
│   │   └── schema/
│   │       ├── tenants.ts               # new — tenants table
│   │       ├── departments.ts           # new — department_templates + departments tables
│   │       └── users.ts                 # new — users table
│   └── provisioning/                    # new module, parallel to existing permissions/
│       ├── provision-tenant.ts           # new — the atomic orchestration function (research.md §1-6)
│       ├── seed-default-departments.ts   # new — mirrors permissions/seed-default-roles.ts
│       └── provisioning-routes.ts        # new — POST /provisioning/tenants (contracts/provision-tenant-api.md)
└── drizzle/                              # amended — new generated migrations on top of 0000-0008
    # 0009  init tenants/departments/department_templates/users tables
    # 0010  RLS: tenants
    # 0011  RLS: departments
    # 0012  RLS: users
    # 0013  tm_app grants: department_templates SELECT-only, tenant tables full CRUD
    # 0014  no-op — user_roles->users FK attempted and reverted (research.md §6)
    # 0015  seed `provision_tenant` permission + grant to Super Admin (research.md §7)
    # 0016  seed department_templates (research.md §5)

apps/web/
└── app/
    └── provisioning/
        └── new/
            └── page.tsx                  # new — provisioning wizard (demoable slice), same
                                           # dev-header-stub + Tailwind/@tm/ui conventions as
                                           # apps/web/app/admin/permissions/page.tsx

packages/types/src/index.ts               # existing — reused as-is (research.md §8); no new
                                           # shared type required for this feature's one contract
```

**Structure Decision**: Extend `apps/api` and `apps/web` in place, exactly as Spec 1 did — this
feature adds no new top-level app or package. Backend logic lives in a new `apps/api/src/provisioning/`
module (parallel to the existing `permissions/` module, calling into it rather than duplicating it),
plus three new Drizzle schema files under `apps/api/src/db/schema/`. The one UI surface lives under
`apps/web/app/provisioning/new/`, following the existing `apps/web/app/admin/` routing convention.

## Complexity Tracking

> No Constitution Check violations require justification. One governance item (unchanged in kind from
> Spec 1) is tracked here for traceability, not as a violation.

| Item | Why Needed | Simpler Alternative Rejected Because | Status |
|------|------------|---------------------------------------|--------|
| Build the provisioning wizard screen (`apps/web/app/provisioning/new/`) before the design system is locked | Spec's Constitution Alignment requires a demoable slice for this milestone (Principle IX) | Deferring the whole feature until the design system locks was considered; rejected because the backend primitive (tables, endpoint, atomicity) has no such dependency and can proceed now — only this one screen's visual build-out should reference the design system once locked, or explicitly flag against it, per Principle V | **Open — flag at implementation time of this screen, same posture Spec 1 already established for its one UI surface** |
