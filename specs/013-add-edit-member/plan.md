# Implementation Plan: Add/Edit Team Member

**Branch**: `013-add-edit-member` | **Date**: 2026-07-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/013-add-edit-member/spec.md`

## Summary

Replaces the current Add Member form's free-text "Role ID" input (which today has *no server-side
validation at all* — an invalid id currently 500s on an uncaught foreign-key violation, not a clean
error) with a searchable dropdown of the tenant's real roles, adds an optional hierarchy-aware
Department dropdown, and adds a brand-new edit capability (no `PATCH`/edit route for team members
exists anywhere in the product today). Both create and edit share one form, rendered in a `Drawer`
(replacing the always-visible inline form), and both dynamically render that tenant's own
"member"-scoped custom fields via the already-generic Custom Fields Framework — the third real
consumer of that framework after Department and the Team Member Directory's own read-only profile
view.

## Technical Context

**Language/Version**: TypeScript (Node.js, both `apps/api` and `apps/web`)

**Primary Dependencies**: Fastify, Drizzle ORM, `pg` (node-postgres), Next.js, `@tm/ui`

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. Reuses the
existing `Drawer`, `validateCustomFieldValues`/`writeCustomFieldValues`/`getFormFields` (Custom
Fields Framework), and the existing `GET /tenant/roles`/`GET /tenant/departments` endpoints for the
two dropdowns' data. No new package.

**Storage**: PostgreSQL (Neon), via `request.tenantDb` — no new tables. One additive migration (a
new `team.edit` permission catalog row + role-template grant + backfill, mirroring every prior
granular-permission migration this codebase already has).

**Testing**: Vitest integration tests against a real Postgres connection
(`apps/api/tests/integration/`), this codebase's established convention.

**Target Platform**: Existing multi-tenant web app (Next.js frontend, Fastify API).

**Project Type**: Web application (existing `apps/web` + `apps/api` monorepo) — no new project.

**Performance Goals**: Same class as every other create/edit form in this codebase — sub-second
round trip for a single-record write plus a handful of dropdown-population reads.

**Constraints**: Role and department values MUST be validated server-side against the caller's own
tenant on every write (spec FR-003/FR-005) — the dropdown's own client-side filtering is a UX
convenience, never the actual security boundary, consistent with every other write route in this
codebase.

**Scale/Scope**: One new API route (`PATCH /tenant/team/:userId`), one existing route extended
(`POST /tenant-auth/team` gains role/department validation and custom-field support it never had),
one migration, one substantially reworked frontend form (moved from an inline page section into a
shared create/edit `Drawer`).

### Storage — what's actually new (all additive)

1. **One new permission catalog row**: `team.edit` (category `settings`, alongside the existing
   `team.create`/`team.view.all`/`team.view.department`/`manage_team_members`) — org-wide only, per
   the spec's own Clarifications (no department-scoped edit tier). Granted to the HR/L&D Admin role
   template and backfilled onto every already-live tenant's HR/L&D Admin-sourced role, mirroring the
   exact pattern `0038`/`0040` already established. `manage_team_members` continues to work as the
   superset — no existing role's access changes.

No schema change to `users`, `roles`, `user_roles`, `departments`, or any Custom Fields Framework
table — this feature is pure route/UI work on top of existing structures.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (tenant isolation)**: PASS. The new `PATCH` route and the extended `POST` route both
  operate exclusively through `request.tenantDb`; role and department existence checks are scoped to
  the caller's own tenant (RLS already enforces this for the `SELECT`s that back the checks).
- **Principle II/III (tenant-configurable structure/forms)**: PASS. The form's only
  tenant-configurable surface is its custom fields, already fully configurable via the existing
  Custom Fields Framework — this spec adds no new fixed field.
- **Principle IV (spec-before-code)**: PASS — spec has zero remaining `[NEEDS CLARIFICATION]`
  markers; the one real ambiguity (edit-permission scope) was resolved during `/speckit-clarify`.
- **Principle V (design system)**: PASS. Reuses the existing `Drawer` (already used by Department,
  Roles, and this same screen's own read-only profile panel) and the existing `field-input`/
  `field-label` form-control classes already used by Department's create/edit form — no new pattern.
- **Principle VI (plan-tier awareness)**: N/A — not stated as tier-gated in the spec.
- **Principle VIII (comprehensive-version rule)**: Followed — during clarification, the
  department-scoped edit tier (the more expansive option) was deliberately *not* chosen, but only
  after being explicitly surfaced as a real tradeoff and confirmed by the user, not silently decided.
- **Principle X (clean branch)**: PASS — branch `013-add-edit-member` created from a clean `master`
  after `012-team-member-directory` was fully merged.
- **Principles XI–XIII (stack/dependencies)**: PASS — no new package.
- **Quality Bar — tenant-isolation impact**: Stated above (no change to isolation model).
- **Quality Bar — configurable vs. fixed**: Stated above and in spec's own Constitution Alignment.
- **Quality Bar — demoable vs. internal**: Demoable.

No violations requiring the Complexity Tracking table.

## Project Structure

### Documentation (this feature)

```text
specs/013-add-edit-member/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
apps/api/
├── drizzle/
│   └── 0042_seed_team_edit_permission.sql   # team.edit + hr_admin grant + backfill
├── src/
│   └── tenant-auth/
│       └── tenant-team-routes.ts             # extend: POST gains role/department/custom-field
│                                              # validation; new PATCH /tenant/team/:userId
└── tests/integration/
    ├── tenant-team-create-validation.test.ts  # role/department validation on POST (the fix)
    ├── tenant-team-edit.test.ts                # PATCH: role/department/name/custom-field updates
    └── tenant-team-edit-permission-gating.test.ts

apps/web/
└── app/(dashboard-shell)/settings/team/
    ├── page.tsx                    # pass canEditMember (manage_team_members || team.edit)
    └── team-settings-client.tsx    # replace inline form with a Create/Edit Drawer; add
                                     # role/department searchable dropdowns; add "Edit member"
                                     # button to the existing read-only profile Drawer
```

**Structure Decision**: The new `PATCH` route is added to the same `tenant-team-routes.ts` file that
already owns `GET /tenant/team` and `POST /tenant-auth/team` — one file per resource, matching every
other module in this codebase. No new frontend file: the existing create/edit-style `Drawer` is added
directly to `team-settings-client.tsx`, mirroring exactly how Department's own file holds both its
view-drawer and its create/edit-drawer together.

## Complexity Tracking

*No Constitution Check violations — table not needed.*
