# Implementation Plan: Super Admin Edit Tenant Configuration

**Branch**: `022-super-admin-edit-tenant-config` | **Date**: 2026-07-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/022-super-admin-edit-tenant-config/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Add nine new routes to the existing
`apps/api/src/super-admin-tenant-console/super-admin-tenant-console-routes.ts` plugin (Spec 020),
each a thin `request.superAdminDb`-scoped wrapper around an existing tenant-side mechanism (Specs
009/010/011/013), with every lookup explicitly filtered by the route's own `:id` (tenant) param
rather than relying on ambient RLS scoping (research.md §1, the same discipline Spec 021 already
established): `PATCH /tenants/:id/members/:memberId` (member edit); `POST`/`PATCH`/
`DELETE /tenants/:id/roles(/:roleId)` (role CRUD); `POST`/`PATCH /tenants/:id/departments(/:departmentId)`
(department create/edit); `POST`/`PATCH /tenants/:id/custom-fields(/:fieldId)` (tenant-scoped custom
field create/edit/archive). No existing tenant-side route's contract changes. Two RLS/grant
corrections surfaced during planning, not assumed from the spec: `roles`/`role_permissions`/
`departments` already carry unrestricted `super_admin_full_access` policies (confirmed, no new
migration), and — contrary to this spec's own first-draft assumption — `form_fields` *also* already
carries one (migration 0028, added ahead of time for Spec 010 FR-002's still-unbuilt global authoring
screen), so this feature's own query logic, not RLS, is what keeps it from reaching a global
(`tenant_id IS NULL`) field (research.md §2). The one genuinely new piece of schema is
`tenant_config_action_log` (two new migrations, `0065`/`0066`), a small append-only table parallel to
`member_action_log`, needed because role/department/custom-field edits don't target a member and so
don't fit that table's shape (spec Clarifications, research.md §3). Frontend: extends the existing
single-file console page (`apps/web/app/(platform-shell)/tenants/[tenantId]/page.tsx`) — Edit actions
added to the Members/Departments/Roles tabs' existing tables, plus one new Forms tab — all using this
page's established Modal pattern, no new page or navigation destination (research.md §5).

## Technical Context

**Language/Version**: TypeScript 5.x on Node 20 — unchanged.

**Primary Dependencies**: Fastify 5, `drizzle-orm`, `pg` on the API side; Next.js App Router +
`@tm/ui` (`Modal`, `Input`, `Button`, `Badge`) on the web side — all already installed and already
used by Specs 020/021's console page and Specs 009/010/011/013's own tenant-side forms.

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. Every
validation rule, write shape, and error case this feature needs already exists in a tenant-side
route; this plan re-implements each as a tenant-scoped equivalent, it does not invent new logic or
reach for a new package.

**Storage**: PostgreSQL, shared schema with RLS — unchanged for `roles`/`role_permissions`/
`departments`/`form_fields`/`custom_field_values`/`users`/`user_roles` (all already have the RLS
access this feature needs, confirmed in research.md §1/§2). One new table, `tenant_config_action_log`
(two new migrations — see data-model.md), same no-RLS/append-only/`tm_app`-`SELECT,INSERT`-only
posture as `member_action_log`.

**Testing**: Vitest, matching `apps/api/tests/integration/`'s existing convention. The behaviors that
must be proven against a real Postgres connection (not assumed from reading the existing tenant-side
routes) are: (a) every new tenant-scoped validation helper actually rejects a role/department/
manager/field-key belonging to a *different* tenant — the same class of regression Spec 020/021's own
cross-tenant-isolation tests targeted; (b) a global (`tenant_id IS NULL`) custom field is genuinely
unreachable (404) through the new custom-field routes, given RLS itself would otherwise permit it
(research.md §2) — this is the one case in this feature where a missing `tenant_id` filter would fail
silently rather than loudly, so it needs its own explicit regression test, not just inference from the
route code.

**Target Platform**: Linux server (Railway) for `apps/api`; Next.js/Railway for `apps/web` —
unchanged.

**Project Type**: Web-service (nine new backend routes, two new migrations) plus new/extended forms
on an existing Next.js page (Spec 020's console) as this feature's demoable slice.

**Performance Goals**: No hard SLA specified by the spec. SC-001–SC-004's "in under one minute" /
"same outcome" targets are UX targets dominated by human form-filling time, not query cost — every
write here is a single-row update/insert/delete plus a handful of small existence-check queries, the
same cost shape as the tenant-side routes being mirrored.

**Constraints**: Every new query MUST filter explicitly by the route's own `:id` (tenant) param —
never relying on `request.superAdminDb`'s ambient RLS context, which is tenant-agnostic by design
(research.md §1). For the custom-fields surface specifically, this constraint is load-bearing in a
new way this feature is the first to hit: RLS itself would permit reaching a global field, so the
`tenant_id = :id` filter in the route's own query is the *only* thing enforcing spec FR-009
(research.md §2) — this is not a defense-in-depth belt-and-suspenders filter here, it is the entire
mechanism.

**Scale/Scope**: Nine new route handlers across four surfaces, one new table (two migrations), four
sets of tenant-scoped validation helpers (mirroring existing ambient-RLS-scoped ones per research.md
§1), and one extended frontend page (three tabs gain edit affordances, one new tab added). No changes
to any existing tenant-side route's contract — every mirrored tenant-side route
(`PATCH /tenant/team/:userId`, `POST`/`PATCH`/`DELETE /tenant/roles(/:roleId)`,
`POST`/`PATCH /tenant/departments(/:departmentId)`, `POST`/`PATCH /tenant/form-fields(/:fieldId)`)
remains byte-for-byte unchanged.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Tenant isolation is a security requirement | **PASS** | No RLS policy is loosened. `roles`/`role_permissions`/`departments` reuse existing unrestricted `super_admin_full_access` policies (confirmed, research.md §1); `form_fields` likewise (research.md §2 — a correction of this spec's own first-draft assumption, confirmed not assumed). Every new route explicitly filters by `tenant_id = :id`; the custom-fields surface additionally depends on that filter to exclude global rows, since RLS alone would permit them (research.md §2) — flagged as its own required regression test in Technical Context > Testing. |
| II. Tenant provisioning includes org structure | **PASS** | This is the direct implementation of Principle II's own promise ("a company MUST be able to rename, add, remove, or restructure departments and permission levels") for the one actor (Super Admin) who couldn't do it on a tenant's behalf until now. |
| III. Forms/flows are tenant-configurable | **PASS** | Same reasoning as II, applied to the custom-fields surface — this feature is what lets a Super Admin configure a tenant's own field set, not a new configurable-entity type. |
| IV. Spec-before-code | **PASS** | This plan follows the ratified spec.md, including its two Clarifications (audit-log table shape; permission-catalog scope). One factual correction (form_fields RLS state) was made to spec.md itself during planning, per the "verify, don't assume" discipline — logged in research.md §2, not silently invented in code. |
| V. Design system (locked via UI-UX-Pro-Max) | **PASS** | Reuses the same `Modal`/`Input`/`Button`/`Badge` components already proven by Specs 020/021's console page and Specs 009/010/011/013's own tenant-side forms — no ad hoc styling, no new component pattern. |
| VI. Plan-tier awareness | N/A | No plan-tier/feature-flag concept is introduced. |
| VII. White-labeling & structural customization | **PASS** | Directly implements the department/role/form-structure half of Principle VII for the Super Admin actor — no branding is touched. |
| VIII. Comprehensive-version rule | **PASS** | Member custom field values were deliberately pulled back into scope here (spec Assumptions) even though Specs 020/021 had narrowed them out — the more complete version, per this principle, with the tradeoff flagged in spec.md rather than silently chosen. |
| IX. Demoable vs. internal | **PASS** | Spec.md states this is stakeholder-demoable — configuring any tenant's roles, departments, forms, and member records from the console is the demoable slice. |
| X. Clean branch per feature | **PASS (pending)** | No `before_specify`/`before_plan` git hook is registered (`.specify/extensions.yml` does not exist) — same gap flagged in every prior spec's plan in this repo, including 021's. Spec/plan authoring happened directly on `master`, matching this repo's actual recent practice (e.g. Spec 021 itself, `0f9cfec`) rather than the constitution's own branch-per-spec ideal — flagged, not silently ignored. A `022-super-admin-edit-tenant-config` branch should be created before implementation begins. |
| XI. Stack is fixed (Next.js/Fastify) | **PASS** | Extends the existing `apps/api` (Fastify) and `apps/web` (Next.js) apps in place. |
| XII. Prefer built-in/native utilities | **PASS** | Every validation rule and write shape is a tenant-scoped port of existing, already-reviewed logic (research.md §1) — the only genuinely new code is the small set of tenant-scoped helper functions and the new table, not a new primitive or pattern. |
| XIII. No new package without explicit permission | **PASS — nothing to approve** | No new dependency is proposed anywhere in this plan. |

No unresolved `[NEEDS CLARIFICATION]` markers remain in Technical Context. Both spec-level
Clarifications were resolved in `/speckit-clarify` before this plan was written; the one
planning-time factual correction (form_fields RLS) is recorded in research.md §2 and reflected back
into spec.md.

## Project Structure

### Documentation (this feature)

```text
specs/022-super-admin-edit-tenant-config/
├── plan.md               # This file (/speckit-plan command output)
├── research.md            # Phase 0 output (/speckit-plan command)
├── data-model.md          # Phase 1 output (/speckit-plan command)
├── quickstart.md          # Phase 1 output (/speckit-plan command)
├── contracts/              # Phase 1 output (/speckit-plan command)
│   └── super-admin-edit-tenant-config-api.md
├── checklists/
│   └── requirements.md
└── tasks.md               # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

Existing pnpm/Turborepo monorepo (unchanged top-level structure):

```text
apps/api/
├── drizzle/
│   ├── 0065_tenant_config_action_log_table.sql          # new
│   └── 0066_lock_tenant_config_action_log_grants.sql     # new
│                                                           # (no migration for roles/role_permissions/
│                                                           #  departments/form_fields — already covered,
│                                                           #  research.md §1/§2)
└── src/
    ├── db/schema/
    │   └── tenant-config-action-log.ts                   # new — mirrors member-action-log.ts's shape
    └── super-admin-tenant-console/
        ├── edit-tenant-member.ts                          # new — PATCH .../members/:memberId handler
        │                                                   #       (+ local tenant-scoped isDepartmentLeader)
        ├── manage-tenant-roles.ts                          # new — POST/PATCH/DELETE .../roles(/:roleId)
        │                                                   #       (+ local tenant-scoped permission-catalog
        │                                                   #       query and member-count check)
        ├── manage-tenant-departments.ts                     # new — POST/PATCH .../departments(/:departmentId)
        │                                                     #       (+ local tenant-scoped hierarchy/manager
        │                                                     #       helpers)
        ├── manage-tenant-custom-fields.ts                    # new — POST/PATCH .../custom-fields(/:fieldId)
        │                                                      #       (+ local tenant-scoped getFormFields/
        │                                                      #       fieldKeyCollisionExists equivalents)
        ├── errors.ts                                       # amended — + SystemRoleError, RoleInUseError,
        │                                                    #           DepartmentHierarchyError, FieldKeyConflictError
        └── super-admin-tenant-console-routes.ts             # amended — registers the nine new routes

apps/web/
└── app/(platform-shell)/tenants/[tenantId]/
    └── page.tsx                                          # amended — Edit actions on Members/Departments/
                                                             #           Roles tabs' tables + new Forms tab,
                                                             #           each with its own Modal
```

**Structure Decision**: No new top-level module — every backend piece is a new file inside Spec 020's
existing `super-admin-tenant-console` module (plus one new schema file for the one new table), and
every frontend piece extends Spec 020/021's existing single console page. Four handler files (one per
surface) rather than one large file, matching this module's existing one-handler-per-concern
convention (`add-tenant-member.ts`, `reset-member-password.ts`, `get-tenant-*.ts` already follow this
shape).

## Complexity Tracking

*No Constitution Check violations — this section is not needed.*
