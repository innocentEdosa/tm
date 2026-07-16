# Implementation Plan: Super Admin Tenant Console

**Branch**: `020-super-admin-tenant-console` | **Date**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/020-super-admin-tenant-console/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Give Super Admins a per-tenant "Manage" console reached from the existing Tenants list
(`apps/web/app/(platform-shell)/tenants/page.tsx`): a new dynamic route
(`apps/web/app/(platform-shell)/tenants/[tenantId]/page.tsx`) rendered inside the platform dashboard
shell, with four read-only sections (company details, department hierarchy, role/permission catalog,
member directory) plus one write action (generate-and-reset a member's password, no email). All four
reads and the one write are new Fastify routes in a new `apps/api/src/super-admin-tenant-console/`
module, registered alongside the existing `tenant-management` routes, guarded by
`requireSuperAdminSession` and executed exclusively through `request.superAdminDb!` — never
`request.tenantDb` or `fastify.pg.pool`.

**The central mechanical fact this plan turns on**: `request.superAdminDb` pins `app.tenant_id` to
the nil UUID (`super-admin-context.ts`'s own documented gotcha) and sets `app.is_super_admin`, so a
tenant-scoped table's RLS resolves entirely through the new `super_admin_full_access` policies added
below — it does **not** implicitly scope any query to one tenant the way `request.tenantDb` does for
an ordinary tenant-user route. Every query this feature adds MUST carry an explicit
`WHERE tenant_id = :targetTenantId` (or an equivalent join-through condition) supplied from the
route's `:id` param — never inferred from session context. This is why the existing
`tenant-department-routes.ts` GET handler's query functions (`findAncestorChain`, `collectSubtreeIds`,
`hasChildren`, the inline `GET /tenant/departments` handler itself) cannot be reused as-is: they
deliberately omit a `tenant_id` filter because `request.tenantDb`'s RLS already limits them to one
tenant implicitly (research.md §1). `permissions/role-member-counts.ts`'s `getRoleMemberCounts` is the
one existing helper safely reusable unmodified, because it groups by `role_id`, a value already
unique per tenant by construction (research.md §2).

Extends RLS with five new additive `super_admin_full_access` policies (`departments`, `roles`,
`role_permissions`, `user_roles`, `users`) — identical shape to the already-shipped `tenants` (0054)
and `user_sessions` (0055) policies from Tenant Management (015) — so `request.superAdminDb` can read
(and, for `users` only, write the password hash of) these tables without touching their existing,
completely unedited `tenant_isolation` policies. Password reset generates a random credential via the
same primitive already used for invite OTPs (`randomBytes(9).toString("base64url")`,
`tenant-auth/otp.ts`), hashes it with the existing `hashPassword` (`platform-auth/password.ts`,
scrypt), and returns the plaintext once in the API response — never persisted, never emailed. Member
session invalidation reuses the existing `user_sessions.revoked_at` column via a new
`revokeUserSessions(db, { tenantId, memberId })` helper alongside the existing
`revokeTenantSessions` in `tenant-management/revoke-tenant-sessions.ts`. A new, append-only
`member_action_log` table (no RLS, Super-Admin-only, same shape/grant posture as the existing
`tenant_action_log`) satisfies FR-011's logging requirement. No new dependencies anywhere in this
feature.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 20 — unchanged, matches every prior spec.

**Primary Dependencies**: Fastify 5, `drizzle-orm`, `pg` on the API side; Next.js App Router +
`@tm/ui` (`PageHeader`, `Card`, `Badge`, `Table`/plain markup, `Pagination`, `Modal`, `Button`,
`Input`) on the web side — all already installed and used identically to Tenant Management (015),
Team Member Directory (012), Roles Management UI (011), and Department Management (009).

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. Every read
is a standard join/query over already-modeled tables; password generation and hashing reuse existing
`node:crypto`-based primitives (`tenant-auth/otp.ts`'s random-token shape, `platform-auth/password.ts`'s
`hashPassword`); session revocation reuses the existing `user_sessions.revoked_at` column and update
idiom.

**Storage**: PostgreSQL, shared schema with RLS — unchanged. One new table (`member_action_log`);
five new additive RLS policies on existing tables; no new columns on any existing table.

**Testing**: Vitest, matching `apps/api/tests/integration/`'s existing convention — RLS enforcement
(the additive policies must not weaken `tenant_isolation` for ordinary tenant-user connections) and
the explicit-tenant-id-filter behavior described above can only be meaningfully verified against a
real Postgres connection, not a mock. See quickstart.md.

**Target Platform**: Linux server (Railway) for `apps/api`; Next.js/Railway for `apps/web` —
unchanged.

**Project Type**: Web-service (five new backend routes: one company-detail GET, three read-only
list GETs, one password-reset POST) plus one new Next.js screen (the tenant console) as this
feature's demoable slice.

**Performance Goals**: No hard SLA specified by the spec. SC-001 (reach any tenant's full detail
within two selections) is a UX/navigation target, not a load target; SC-002 (reset a password in
under one minute) is dominated by human interaction time, not query cost. Each read query is a single
indexed lookup over tables expected to hold tens to low hundreds of rows per tenant at this stage
(consistent with every prior tenant-facing spec's own Scale/Scope) — no new pagination-performance
concern beyond the existing `PAGE_SIZE = 25` convention already used by the Tenants list and Team
Directory.

**Constraints**: Every route added by this feature MUST filter by the `:id` route param explicitly
(never rely on `request.superAdminDb`'s ambient RLS context, which is deliberately tenant-agnostic —
see Summary). The password-reset route MUST NOT send email and MUST NOT set `mustChangePassword`
(spec Clarifications: not forced). All data requests from the new frontend page MUST go through the
existing `/platform-api/*` same-origin rewrite proxy (`apps/web/next.config.ts`), never a direct
`API_ORIGIN` fetch — reusing the fix already in place for every other Super Admin page.

**Scale/Scope**: Five new route handlers, one new frontend page (four sections/tabs), one new
database table, five new RLS policies, one new session-revocation helper, one new password-generation
helper. No changes to any existing route's contract (015, 009, 011, 012 remain byte-for-byte
unchanged — this feature only adds new, additively-gated read paths onto the same underlying tables).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Tenant isolation is a security requirement | **PASS** | Five new `super_admin_full_access` policies are additive permissive policies alongside each table's existing, completely unedited `tenant_isolation` policy (research.md §3) — no tenant-scoped connection (`request.tenantDb`) gains any new access; only a verified Super Admin session does. Every new route explicitly filters by the route's `:id`/`:memberId` param rather than relying on ambient RLS scoping, since `request.superAdminDb` is deliberately tenant-agnostic (Summary). `member_action_log` is platform-level, no `tenant_id` RLS scoping, Super-Admin-only — same posture as `tenant_action_log`. |
| II. Tenant provisioning includes org structure | N/A | This feature reads an existing tenant's already-provisioned departments/roles; it provisions nothing new. |
| III. Forms/flows are tenant-configurable | N/A | This console is platform-internal Super Admin tooling, not a tenant-facing form — no per-tenant field/step override applies (mirrors Tenant Management's own N/A here). |
| IV. Spec-before-code | **PASS** | This plan follows the ratified spec.md; both clarifications (system-generated password, not forced; console works regardless of tenant status) are recorded in spec.md's Clarifications section and threaded through here, not invented in this plan. |
| V. Design system (locked via UI-UX-Pro-Max) | **PASS** | Built against the already-locked `design-system/tm/MASTER.md`, reusing the same platform-shell components already proven by `tenants/page.tsx` and `admin/permissions/page.tsx` — no ad hoc styling. |
| VI. Plan-tier awareness | N/A | No plan-tier/feature-flag concept is introduced; this is a Super-Admin-only platform capability with no tenant-facing tier gating. |
| VII. White-labeling & structural customization | N/A | This feature reads each tenant's already-configured branding-adjacent structure (departments, roles) but introduces no new configurable entity and changes no existing one. |
| VIII. Comprehensive-version rule | N/A | No conflicting-scope tradeoff surfaced during planning; both spec clarifications were resolved directly with the stakeholder in `/speckit-specify`, not narrowed here. |
| IX. Demoable vs. internal | **PASS** | Spec.md's Constitution Alignment states this is stakeholder-demoable; unchanged here — opening a tenant's console and resetting a member's password without email is the demoable slice. |
| X. Clean branch per feature | **PASS (pending)** | No `before_specify`/`before_plan` git hook is registered (`.specify/extensions.yml` does not exist), so branch creation remains a manual step outside this command — same gap already flagged in the constitution's own Sync Impact Report and in Tenant Management's plan. Working tree had only an unrelated, pre-existing modified file (`TM.code-workspace`) when this plan was authored. |
| XI. Stack is fixed (Next.js/Fastify) | **PASS** | Extends the existing `apps/api` (Fastify) and `apps/web` (Next.js) apps in place. |
| XII. Prefer built-in/native utilities | **PASS** | Password generation reuses the existing `node:crypto`-based random-token idiom already shipped for invite OTPs; hashing reuses the existing `hashPassword`; session revocation reuses the existing `user_sessions.revoked_at` column/update idiom; logging reuses the existing append-only-table idiom already shipped for `tenant_action_log`. No new library for any of these. |
| XIII. No new package without explicit permission | **PASS — nothing to approve** | No new dependency is proposed anywhere in this plan. |

No unresolved `[NEEDS CLARIFICATION]` markers remain in Technical Context. Both spec-level
clarifications were resolved directly in `/speckit-specify` before this plan was written.

## Project Structure

### Documentation (this feature)

```text
specs/020-super-admin-tenant-console/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/             # Phase 1 output (/speckit-plan command)
│   └── super-admin-tenant-console-api.md
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
│   │       └── member-action-log.ts               # new — member_action_log table
│   ├── tenant-management/
│   │   └── revoke-tenant-sessions.ts               # amended — + revokeUserSessions export
│   └── super-admin-tenant-console/                 # new module, parallel to tenant-management/
│       ├── get-tenant-detail.ts                     # new — GET /tenants/:id (company fields)
│       ├── get-tenant-departments.ts                # new — GET /tenants/:id/departments
│       ├── get-tenant-roles.ts                      # new — GET /tenants/:id/roles
│       ├── get-tenant-members.ts                    # new — GET /tenants/:id/members
│       ├── reset-member-password.ts                 # new — POST /tenants/:id/members/:memberId/reset-password
│       ├── generate-password.ts                     # new — random-password primitive (research.md §4)
│       └── super-admin-tenant-console-routes.ts     # new — registers all five routes, requireSuperAdminSession
└── drizzle/                                        # amended — new generated migrations on top of 0056
    # 0057  generated: member_action_log table
    # 0058  member_action_log: lock tm_app grants to SELECT/INSERT only (append-only, mirrors 0056)
    # 0059  departments: super_admin_full_access RLS policy
    # 0060  roles: super_admin_full_access RLS policy
    # 0061  role_permissions: super_admin_full_access RLS policy
    # 0062  user_roles: super_admin_full_access RLS policy
    # 0063  users: super_admin_full_access RLS policy

apps/web/
└── app/(platform-shell)/tenants/
    ├── page.tsx                                    # amended — "Manage" row action added, links to [tenantId]
    └── [tenantId]/
        └── page.tsx                                # new — the console: Company/Departments/Roles/Members
                                                      #       tabs, password-reset action + result modal
```

**Structure Decision**: Web-service monorepo, unchanged top-level layout. A new backend module
(`super-admin-tenant-console/`) mirrors the existing `tenant-management/` module's shape and guard
convention exactly. The frontend adds one new dynamic route nested under the existing `tenants/`
directory rather than a new top-level nav destination (spec Assumptions — reached only via a row
action on the existing Tenants list).

## Complexity Tracking

*No Constitution Check violations — this section is not needed.*
