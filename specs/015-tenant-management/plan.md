# Implementation Plan: Tenant Management

**Branch**: `015-tenant-management` | **Date**: 2026-07-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/015-tenant-management/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Give Super Admins a `GET /tenants` list view backed page (replacing the "Provision Tenant" nav entry
with "Tenants") plus five new Super-Admin-only Fastify actions against an existing tenant:
edit (`PATCH /tenants/:id`), archive/reactivate (`POST /tenants/:id/archive` |
`/reactivate`), downgrade (`POST /tenants/:id/downgrade`), and soft-delete/recover
(`POST /tenants/:id/delete` | `/recover`). Archive and pending-deletion are modeled as new nullable
timestamp columns on the existing `tenants` table (`archivedAt`, `deletionRequestedAt`,
`deletionPurgeAt`), mirroring the already-shipped `users.archivedAt` soft-delete precedent (Add/Edit
Team Member spec) rather than inventing a new pattern. Downgrade writes only to the existing `status`
column — no plan-tier concept is introduced (spec Clarifications). A new platform-level
`tenant_action_log` table (no RLS, Super-Admin-only, same shape as `super_admin_sessions`) satisfies
FR-016's logging requirement. Session termination on archive/delete reuses the existing
`user_sessions.revoked_at` column and the existing `tenant-user-context.ts` per-request gate (which
already denies a session the moment `users.archived_at` is set) — extended to also deny on the
tenant's own `archivedAt`/`deletionRequestedAt`, plus an active bulk revoke for the "immediate" gate.
The permanent-purge step after the deletion grace period runs as a standalone script
(`apps/api/scripts/purge-deleted-tenants.ts`), mirroring the existing `seed-super-admin.ts` script
pattern — invoked by an external scheduler, no new dependency. No new dependencies anywhere in this
feature.

**Planning surfaced a blocking gap that must ship as part of this feature, not around it**: the
`tenants` table's existing RLS policy only ever lets a connection see the one row matching its own
`app.tenant_id` — by design, and explicitly flagged in that policy's own migration comment as needing
"its own narrow ... read path" for a future "list all tenants" console. That console is this feature.
This plan adds a `super_admin_full_access` RLS policy to both `tenants` and `user_sessions`, reusing the
exact `app.is_super_admin` dual-policy shape already shipped for `form_fields` (research.md §8) — every
route in this feature reads/writes through `request.superAdminDb` (already decorated on every Super
Admin request; previously unused by any tenant-touching table) rather than `fastify.pg.pool` or
`request.tenantDb`.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 20, matching every prior spec in this repo (`apps/api`'s
`packages/tsconfig/node.json`, `apps/web`'s Next.js App Router config) — unchanged.

**Primary Dependencies**: Fastify 5, `@fastify/cors`, `@fastify/postgres`, `drizzle-orm`, `pg` on the
API side; Next.js App Router + `@tm/ui` (the locked design system components: `Button`, `Input`,
`Card`, `Badge`, `PageHeader`, `Pagination`, `Drawer`) on the web side — all already installed and used
identically to the Team Member Directory (012) and Tenant Provisioning Core (002) specs.

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. Listing,
editing, archiving, downgrading, and soft-deleting a tenant are all standard CRUD-shaped operations
covered by the already-installed Fastify/Drizzle/Postgres stack; the purge step is a standalone script
identical in shape to the already-installed `tsx`-run `seed-super-admin.ts`, needing no scheduler
library (research.md §5).

**Storage**: PostgreSQL — the same shared-schema-with-RLS database every prior spec uses. Local dev:
existing `docker-compose.yml` Postgres 16 container. Production/staging: Neon, unchanged.

**Testing**: Vitest, matching the `apps/api/tests/integration/` convention used by every prior
API-touching spec (e.g. `provision-tenant-*.test.ts`) — integration tests run against a real Postgres
connection, since RLS enforcement, the soft-delete/session-termination interaction, and the grace-period
purge cannot be meaningfully verified against a mock. See quickstart.md.

**Target Platform**: Linux server (Railway), long-running Fastify process for the API; the same
Next.js/Railway deploy for `apps/web` — unchanged from every prior spec.

**Project Type**: Web-service (five new backend actions on an existing entity + one new table) with one
new Next.js screen (the Tenants list, replacing the provisioning form as the nav destination) as this
feature's demoable slice.

**Performance Goals**: No hard SLA specified by the spec. SC-001 (find any tenant in under 10 seconds)
is a human-in-the-loop UX target; the list endpoint is a single indexed query over a table expected to
hold tens to low hundreds of rows at this stage (research.md §1 in Tenant Provisioning Core's own
Scale/Scope), so no pagination-performance concern beyond the existing `Pagination` component's
established page-size convention (`PAGE_SIZE = 25`, matching `team-settings-client.tsx`).

**Constraints**: Session-termination on archive/delete MUST be effective for both (a) requests made
after the action (blocked by a per-request tenant-status gate) and (b) sessions already established
before the action (actively revoked in `user_sessions`, not merely left to expire) — per the
Clarifications' "immediate termination" answer, this is a two-part guarantee, not one or the other
(research.md §3). Subdomain edits MUST reuse Tenant Provisioning Core's exact uniqueness/reserved-word
validation path (FR-006), never a second, independently-maintained check.

**Scale/Scope**: Same working assumption as every prior tenant-facing spec — tens of tenants at this
stage, not a hard limit. One new table (`tenant_action_log`), three new columns on `tenants`
(`archivedAt`, `deletionRequestedAt`, `deletionPurgeAt`), two new RLS policies (`tenants`,
`user_sessions` — research.md §8), six new route handlers, one new screen, one new standalone purge
script.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Tenant isolation is a security requirement | **PASS** | This feature adds a `super_admin_full_access` RLS policy to `tenants` and `user_sessions` (research.md §8) — an *additive* permissive policy alongside the existing, completely unedited `tenant_isolation` policy, scoped only to the already-proven `app.is_super_admin` server-set flag (never client input). No tenant session (`app.tenant_id`-scoped connection) gains any new access; only a verified Super Admin session does. `tenant_action_log` is platform-level, no `app.tenant_id` scoping, Super-Admin-only — same shape as `super_admin_sessions`. Every route in this feature is guarded by `requireSuperAdminSession`; none uses `request.tenantDb`. |
| II. Tenant provisioning includes org structure | N/A | This feature edits/transitions an existing tenant's lifecycle state; it does not touch department/role provisioning, which Tenant Provisioning Core already covers. |
| III. Forms/flows are tenant-configurable | N/A | The Tenants list, edit form, and confirmation dialogs are platform-internal Super Admin tooling, not a tenant-facing form — no per-tenant field/step override applies here (mirrors Tenant Provisioning Core's own N/A for this principle). |
| IV. Spec-before-code | **PASS** | This plan follows the ratified spec.md; both clarifications (downgrade = status-only, delete = soft with grace period + immediate session termination) are recorded in spec.md's Clarifications section and threaded through this plan, not invented here. |
| V. Design system (locked via UI-UX-Pro-Max) | **PASS** | The design system is now locked (`design-system/tm/MASTER.md`, established by the Desktop Shell Visual Language spec and already used by `(platform-shell)/provisioning/new/page.tsx`). The new Tenants list/edit screens MUST be built against it — no ad hoc styling, no "pending lock" flag needed (unlike Tenant Provisioning Core's plan, written before the lock). |
| VI. Plan-tier awareness | N/A | Spec Clarifications explicitly keep Downgrade to the existing `status` field only; this feature introduces no plan-tier/feature-flag concept (consistent with Tenant Provisioning Core FR-012, still not built). |
| VII. White-labeling & structural customization | N/A | No branding, department, permission, form, or workflow structure is touched by this feature — it operates on the platform-level `Tenant` record's lifecycle state and contact/company fields only. |
| VIII. Comprehensive-version rule | N/A | No conflicting-scope tradeoff surfaced during planning; spec.md's soft-delete-with-grace-period answer (Q1) was itself the more complete of the offered options relative to an immediate hard delete, chosen by the stakeholder directly, not defaulted here. |
| IX. Demoable vs. internal | **PASS** | Spec.md's Constitution Alignment states this is stakeholder-demoable; unchanged here — opening the Tenants list, editing a tenant, archiving/reactivating, downgrading, and deleting-with-confirmation is the demoable slice. |
| X. Clean branch per feature | **PASS (pending)** | No `before_specify`/`before_plan` git hook is registered in this repo (`.specify/extensions.yml` does not exist), so branch creation is a manual step outside this command, same gap already flagged in this constitution file's own Sync Impact Report. Working tree was clean of unrelated changes when this spec/plan were authored. |
| XI. Stack is fixed (Next.js/Fastify) | **PASS** | Extends the existing `apps/api` (Fastify) and `apps/web` (Next.js) apps in place; no alternative framework introduced. |
| XII. Prefer built-in/native utilities | **PASS** | Archive/pending-deletion reuse the existing `users.archivedAt` nullable-timestamp idiom rather than a new state-machine library; session termination reuses the existing `user_sessions.revoked_at` column and per-request gate idiom already proven in `tenant-user-context.ts`; the purge step reuses the existing standalone-`tsx`-script idiom (`seed-super-admin.ts`) rather than adding a scheduler package (research.md §5). |
| XIII. No new package without explicit permission | **PASS — nothing to approve** | No new dependency is proposed anywhere in this plan (see Technical Context and research.md §5). |

No unresolved `[NEEDS CLARIFICATION]` markers remain in Technical Context. Both spec-level
clarifications were resolved directly in `/speckit-specify` before this plan was written.

## Project Structure

### Documentation (this feature)

```text
specs/015-tenant-management/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/             # Phase 1 output (/speckit-plan command)
│   └── tenant-management-api.md
├── checklists/
│   └── requirements.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

Existing pnpm/Turborepo monorepo (unchanged top-level structure):

```text
apps/api/
├── src/
│   ├── db/
│   │   └── schema/
│   │       ├── tenants.ts                    # amended — + archivedAt, deletionRequestedAt, deletionPurgeAt
│   │       └── tenant-action-log.ts          # new — tenant_action_log table
│   ├── tenant-auth/
│   │   └── tenant-user-context.ts            # amended — deny on tenants.archivedAt/deletionRequestedAt,
│   │                                          #           mirroring the existing users.archivedAt check
│   └── tenant-management/                    # new module, parallel to existing provisioning/
│       ├── list-tenants.ts                    # new — GET /tenants query, via request.superAdminDb
│       ├── edit-tenant.ts                     # new — PATCH /tenants/:id (reuses provisioning's
│       │                                       #       subdomain validation, contracts/ §Edit)
│       ├── archive-tenant.ts                   # new — archive/reactivate + session revoke
│       ├── downgrade-tenant.ts                 # new — status step-down
│       ├── delete-tenant.ts                    # new — soft-delete/recover + session revoke
│       └── tenant-management-routes.ts         # new — registers all six routes, requireSuperAdminSession
├── scripts/
│   └── purge-deleted-tenants.ts               # new — standalone script, mirrors seed-super-admin.ts
└── drizzle/                                   # amended — new generated migrations on top of 0052
    # 0053  generated: tenants add archived_at/deletion_requested_at/deletion_purge_at
    #       + new tenant_action_log table (one drizzle-kit generate over both schema changes)
    # 0054  tenants: super_admin_full_access RLS policy (research.md §8 — additive,
    #       tenant_isolation left unedited)
    # 0055  user_sessions: super_admin_full_access RLS policy (research.md §8, same shape)
    # 0056  tm_app grants: tenant_action_log INSERT/SELECT-only (no UPDATE/DELETE — append-only)

apps/web/
└── app/
    └── (platform-shell)/
        ├── layout.tsx                        # amended — nav entry "Provision Tenant" → "Tenants",
        │                                       #           href "/provisioning/new" → "/tenants"
        └── tenants/
            ├── page.tsx                       # new — server component, same pattern as
            │                                   #       settings/team/page.tsx
            └── tenants-client.tsx             # new — list + row actions + confirmation dialogs,
                                                #       same pattern as team-settings-client.tsx;
                                                #       "Add Tenant" links to existing
                                                #       (platform-shell)/provisioning/new/page.tsx

packages/types/src/index.ts                    # existing — reused as-is; no new shared type required
```

**Structure Decision**: Extend `apps/api` and `apps/web` in place, exactly as every prior spec has.
Backend logic lives in a new `apps/api/src/tenant-management/` module (parallel to the existing
`provisioning/` module, calling into its subdomain-validation logic rather than duplicating it), plus
one new Drizzle schema file and three new columns on the existing `tenants.ts`. The one UI surface
lives under `apps/web/app/(platform-shell)/tenants/`, following the existing `(platform-shell)` routing
convention (`provisioning/new/`, `admin/permissions/`). `provisioning/new/page.tsx` itself is
unchanged — only how it's reached (via an "Add Tenant" link from the new list, not the nav) changes.

## Complexity Tracking

> No Constitution Check violations require justification.

| Item | Why Needed | Simpler Alternative Rejected Because | Status |
|------|------------|---------------------------------------|--------|
| Two-part session termination (per-request gate + active bulk revoke) rather than one mechanism | Spec Clarifications explicitly require "immediate," not "denied on next request" (research.md §3) | An active-revoke-only approach was considered but rejected: `tenant-user-context.ts` already has a proven per-request gate for exactly this shape of problem (`users.archivedAt`); skipping it would mean re-deriving a check that already exists, purely to save one `UPDATE` statement | **Resolved — both parts implemented, neither optional** |
