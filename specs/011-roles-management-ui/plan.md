# Implementation Plan: Roles Management UI

**Branch**: `011-roles-management-ui` | **Date**: 2026-07-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-roles-management-ui/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

A tenant-facing Administration > Roles screen built on top of the existing Roles & Permissions API
(Spec 001), which today only exposes `POST`/`PATCH`/`DELETE /tenant/roles/:roleId` — no list endpoint,
no tenant-facing permission catalog, and no server-side protection for the four system roles every
tenant is provisioned with. This spec closes those three concrete gaps (confirmed by reading the
existing route/schema code directly, not assumed) and layers a UI on top: one combined list of system
and custom roles with member counts, a create/edit drawer whose permission checklist is generated
entirely from the catalog's own `category` field, an impact-warning dialog gated on live member count,
and a blocked-delete flow mirroring Department Management's own pattern. The sidebar's disabled "Roles"
placeholder becomes real; "Permission" is removed outright. No new tables, no new permission key, no
new dependency — `manage_roles` (already seeded, already granted to every tenant's `hr_admin` role,
confirmed present on all 693 existing "HR/L&D Admin" rows in the dev database) gates the whole screen.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 20, CommonJS output — unchanged, matches every other
backend feature in this repo.

**Primary Dependencies**: Fastify 5, Drizzle ORM (existing). Extends `apps/api/src/permissions/
tenant-role-routes.ts` in place — that file's own established convention is a single `requirePermission
("manage_roles")` preHandler (not the `requireTenantUserSession()` + `requirePermission(...)` pair
newer files like `tenant-department-routes.ts` use, since `requirePermission` already checks
`request.user` itself) — new routes in this same file follow its own existing convention rather than
importing the newer pattern.

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None.

**Storage**: PostgreSQL — Neon in production/staging, local Docker Postgres 16 in development. No new
tables, no new columns, and no new migration at all — the system-role guard is a pure
application-layer check in the existing route handlers (research.md §2), and the permission-seeding
question this spec's context raised turned out to already be satisfied with zero gap (research.md §1).

**Testing**: Vitest (existing dev dependency), real Postgres connection, mirroring every prior spec's
integration-test convention in this repo.

**Target Platform**: Linux server (Railway) — unchanged.

**Project Type**: Web application (existing pnpm/Turborepo monorepo) — no new top-level project.

**Performance Goals**: No hard SLA. A tenant's total role count is small (four system roles plus
whatever custom roles that tenant has created — expected low tens at most), so the list/member-count
queries need no pagination or special indexing beyond what already exists on `user_roles`/`roles`.

**Constraints**: System roles (`source_template_id IS NOT NULL`) must be provably unmodifiable — FR-005
requires this hold even against a direct API call, not merely a UI affordance — so the guard belongs in
the route handlers themselves (research.md §2), not only in what the frontend renders. `manage_roles`
already exists and is already correctly granted to every tenant's `hr_admin`-derived role today
(verified directly against the dev database — 693/693 "HR/L&D Admin" rows already have it, unlike the
historical `department.manage`/`forms.manage.tenant` gap Specs 009/010 had to backfill) — no seeding
migration is needed for this spec.

**Scale/Scope**: A handful of roles per tenant, a fixed and currently small permission catalog (~10
keys across ~8 categories today, expected to grow slowly as future modules ship) — sized for a plain
list/checklist UI, no virtualization needed.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Tenant isolation is a security requirement | **PASS** | Every new/extended route operates through `request.tenantDb` (RLS-scoped), exactly like the three existing role-mutation routes it sits alongside — no new isolation mechanism. |
| II. Tenant provisioning includes org structure | N/A | This spec touches role/permission configuration, not org structure directly. |
| III. Forms/flows are tenant-configurable | **PASS** | Reinforces the existing split: permission *keys* are fixed platform-wide (seeded per module), which *roles* exist and what each one grants is fully tenant-configurable — this spec doesn't change that split, it's the first UI to fully expose it. |
| IV. Spec-before-code | **PASS** | Follows the ratified, clarified spec; the three concrete API gaps (list endpoint, tenant-facing catalog endpoint, system-role guard) were confirmed by reading the actual existing code before writing this plan, not assumed. |
| V. Design system (locked) | **PASS** | Reuses `Card`/`Badge`/`Drawer`/`Modal`/`Button`/`Input` from `packages/ui` and the row-actions kebab-menu pattern already established for Department Management (Spec 009) — no new visual pattern. |
| VI. Plan-tier awareness | N/A | No tier-gating signal in this spec; custom role creation is unlimited at every tier, consistent with how Department/Forms also ship tier-unaware in v1. |
| VII. White-labeling & structural customization | **PASS** | Custom roles and their permission sets are fully tenant-runtime-configurable; nothing tenant-specific is hardcoded. |
| VIII. Comprehensive-version rule | **PASS** | The system-role protection is specified and implemented as real server-side enforcement (FR-005), not a UI-only illusion that would be a smaller, incomplete guarantee. |
| IX. Demoable vs. internal | **PASS** | Demoable end-to-end: create a custom role, assign it real permissions, edit it with members assigned and see the impact-warning dialog fire. |
| X. Clean branch per feature | **PASS** | Branch `011-roles-management-ui` created from a clean, up-to-date `master`. |
| XI. Stack is fixed (Next.js/Fastify) | **PASS** | Only Fastify and Next.js used. |
| XII. Prefer built-in/native utilities | **PASS** | Reuses the existing `Modal`/`Drawer`/kebab-menu primitives verbatim; no new UI library. |
| XIII. No new package without explicit permission | **PASS — N/A, none requested** | Zero new npm packages needed. |

No unresolved `[NEEDS CLARIFICATION]` markers remain in Technical Context.

## Project Structure

### Documentation (this feature)

```text
specs/011-roles-management-ui/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
│   └── tenant-roles-management-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

Existing pnpm/Turborepo monorepo — no new top-level project. Extends `apps/api` and `apps/web` in
place, following the exact conventions the existing `tenant-role-routes.ts` and Department Management's
own settings screen already established:

```text
apps/api/
├── src/permissions/
│   ├── tenant-role-routes.ts        # existing (Spec 001) — gains GET /tenant/roles (list + member
│   │                                 #   counts + isSystem), GET /tenant/permission-catalog (grouped
│   │                                 #   by category), and a system-role guard added to the existing
│   │                                 #   PATCH/DELETE handlers
│   └── role-member-counts.ts        # new — shared query: role_id -> member count via user_roles
│                                     # (no drizzle/ changes — the system-role guard is an
│                                     # application-layer check, not a migration, research.md §2)
└── tests/integration/
    ├── tenant-roles-list.test.ts                 # new
    ├── tenant-roles-permission-catalog.test.ts    # new
    ├── tenant-roles-system-role-protection.test.ts # new
    ├── tenant-roles-edit-impact-warning.test.ts    # new (API-level: member count surfaced correctly)
    └── tenant-roles-delete-blocked.test.ts          # new

apps/web/
└── app/(dashboard-shell)/settings/roles/
    ├── page.tsx                    # new — Server Component route guard (mirrors settings/department/
    │                                #        page.tsx)
    └── roles-settings-client.tsx   # new — role list, Create/Edit drawer with grouped permission
                                     #        checklist, impact-warning Modal, blocked-delete Modal
                                     #        with a link toward Members

apps/web/app/(dashboard-shell)/layout.tsx  # existing — "Roles" nav entry becomes a real, enabled link
                                            #            gated on `manage_roles` (not the broader
                                            #            Administration-section condition it currently
                                            #            shares); "Permission" nav entry removed
```

**Structure Decision**: Extend `apps/api/src/permissions/tenant-role-routes.ts` and `apps/web`'s
existing conventions in place — no new package, no new service. The two new GET endpoints and the
system-role guard live in the same file as the three existing mutation routes they complete.

## Complexity Tracking

> No constitution violations require justification. The items below are scope-boundary/design
> judgment calls surfaced during planning, recorded here for traceability.

| Item | Why Needed | Simpler Alternative Rejected Because | Status |
|------|------------|---------------------------------------|--------|
| Adding a real, server-side system-role guard where none exists today | Spec FR-005/SC-002 require this hold even against a direct API call; today nothing in `tenant-role-routes.ts` checks `sourceTemplateId` before allowing a PATCH/DELETE | Leaving system-role protection as UI-only (disabled buttons) was rejected — it would silently violate FR-005/SC-002 and directly contradict Principle VIII's comprehensive-version rule | Resolved — see research.md §2 |
| Two new GET endpoints added to an API this spec was told to treat as "already built" | The spec is UI-focused, but the UI cannot render a role list or a permission checklist without them — confirmed by reading the actual route file, not assumed | Mocking this data on the frontend, or having the frontend call three separate existing endpoints and reassemble it client-side, was rejected as both slower and a worse API shape than two purpose-built reads | Resolved — see research.md §3/§4 |
