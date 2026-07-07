# Implementation Plan: Team Member Directory (List View)

**Branch**: `012-team-member-directory` | **Date**: 2026-07-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/012-team-member-directory/spec.md`

## Summary

A permission-scoped, server-paginated, searchable list of a tenant's team members — org-wide for
`team.view.all` holders, department-subtree-scoped for `team.view.department` holders — with a
hierarchy-aware department filter and a slide-out profile panel revealing that tenant's own configured
"member" custom fields plus invite metadata. Built entirely on existing infrastructure: no new
list route exists today (only invite-creation does), no pagination pattern exists anywhere in this
codebase yet, and the two gating permissions do not exist yet — all three are net-new, additive
work introduced by this spec, following patterns already established for Department/Roles/Forms.

## Technical Context

**Language/Version**: TypeScript (Node.js, both `apps/api` and `apps/web`)

**Primary Dependencies**: Fastify, Drizzle ORM, `pg` (node-postgres), Next.js, `@tm/ui` (this
repo's internal design-system package)

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. Pagination
is plain `LIMIT`/`OFFSET` SQL via Drizzle (already the query layer everywhere else); the department
subtree filter reuses the existing `collectSubtreeIds` helper; no new package is needed for any part
of this feature.

**Storage**: PostgreSQL (Neon), via `request.tenantDb` (RLS-scoped, existing tenant-isolation
plumbing) — no new tables, three additive schema/data changes (see Storage note below).

**Testing**: Vitest integration tests against a real Postgres connection (`apps/api/tests/integration/`,
this codebase's established convention — no mocked database for permission-gating or RLS-adjacent
behavior).

**Target Platform**: Existing multi-tenant web app (Next.js frontend, Fastify API), same as every
prior spec.

**Project Type**: Web application (existing `apps/web` + `apps/api` monorepo structure) — no new
project.

**Performance Goals**: List queries return in well under 1s for tenants with hundreds of members,
consistent with every other list screen in this codebase (no new performance class introduced).

**Constraints**: Visibility scoping and search must be enforced entirely server-side (spec FR-003,
FR-008) — a department-scoped viewer must never receive another department's row over the wire,
regardless of what the client requests.

**Scale/Scope**: One new list-and-detail screen, one new API route, three additive migrations
(permission catalog + role-template grants, a `member` form-definition seed row, and a new nullable
`users.invited_by` column), one new small reusable pagination UI primitive.

### Storage — what's actually new (all additive, no destructive change)

1. **Two new permission catalog rows**: `team.view.all`, `team.view.department` (category
   `settings`, alongside the existing `manage_team_members`/`team.create`) — neither exists today
   (research.md §1). Granted to role templates: `team.view.all` → HR/L&D Admin (mirrors its
   existing org-wide access to every other module); `team.view.department` → Manager (mirrors
   Manager's existing department-scoped `view_department_analytics` grant). HR/L&D Admin does not
   also need `team.view.department` — `team.view.all` is a strict superset for this feature's own
   scoping logic.
2. **One new `form_definitions` row**: `key = 'member'` — mirrors `0030_seed_department_form_definition.sql`
   exactly (research.md §4: the Custom Fields Framework is already fully generic; `entity_id` has no
   DB-level FK, `getFormFields(tenantDb, formKey)` takes a plain string). No schema change to the
   framework itself.
3. **One new nullable column**: `users.invited_by` (`uuid`, FK → `users.id`, `onDelete: "set null"`).
   Research confirmed `users` has no existing column that answers "who invited this member" — only
   `createdAt` answers "when" (spec FR-006's own metadata requirement). Populated going forward by
   the existing `POST /tenant-auth/team` handler at creation time; existing rows get `NULL` (no way
   to know retroactively — same "look-forward-only" precedent as every prior spec's genuinely new
   column in this codebase).

No change to `departments`, `roles`, or any RLS policy shape — this feature reads through existing
tenant-scoped tables and adds one application-layer subtree filter on top, per Constitution Principle I.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (tenant isolation)**: PASS. All reads go through `request.tenantDb`; the new
  department-subtree visibility filter is an additional narrowing on top of RLS's tenant boundary
  (identical shape to `team.view.department`'s own server-side enforcement requirement, spec FR-003),
  never a substitute for it.
- **Principle II/III (tenant-configurable structure/forms)**: PASS. The directory's only
  tenant-configurable surface is its custom fields, already fully tenant-configurable via the
  existing Custom Fields Framework (spec FR-005) — this spec adds no new fixed HR-specific columns.
- **Principle IV (spec-before-code)**: PASS — this plan follows an already-clarified spec with zero
  remaining `[NEEDS CLARIFICATION]` markers.
- **Principle V (design system)**: PASS. Reuses existing `@tm/ui` primitives (Card, Badge,
  PageHeader, portaled row-actions kebab, the `Drawer` slide-out panel already used by Department's own detail view).
  One new primitive is added — a pagination control — since none exists yet anywhere in this
  codebase; it follows the same visual language as existing primitives, not a new style.
- **Principle VI (plan-tier awareness)**: N/A — this feature is not gated by plan tier in the spec;
  no tier-gating requirement was stated.
- **Principle VIII (comprehensive-version rule)**: Followed — department-subtree scoping (not
  single-department-only) was chosen as the default for `team.view.department`, matching the more
  complete interpretation already established by Department's own hierarchy model, not a narrower one.
- **Principle X (clean branch)**: PASS — branch `012-team-member-directory` was created from a clean
  `master` after the prior feature (`011-roles-management-ui`) was fully merged.
- **Principles XI–XIII (stack/dependencies)**: PASS — no new package, fixed Next.js/Fastify stack
  throughout (see New Dependencies note above).
- **Quality Bar — tenant-isolation impact statement**: Stated above (no change to isolation model).
- **Quality Bar — configurable vs. fixed**: Stated in spec's own Constitution Alignment section and
  reaffirmed above (five core columns fixed platform-wide; every other field tenant-configurable).
- **Quality Bar — demoable vs. internal**: Demoable (spec's own Constitution Alignment section).

No violations requiring the Complexity Tracking table.

## Project Structure

### Documentation (this feature)

```text
specs/012-team-member-directory/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
apps/api/
├── drizzle/
│   ├── 0039_add_users_invited_by.sql             # new nullable column + FK
│   ├── 0040_seed_team_view_permissions.sql       # team.view.all/team.view.department + role grants
│   └── 0041_seed_member_form_definition.sql      # member form_definitions row (mirrors 0030)
├── src/
│   ├── db/schema/users.ts                    # add invitedBy column
│   ├── tenant-auth/
│   │   ├── tenant-team-routes.ts             # extend: new GET /tenant/team list route;
│   │   │                                     # existing POST handler also sets invitedBy
│   │   └── team-visibility.ts                # new: resolves viewer's own department + subtree ids
│   └── permissions/require-permission.ts     # reused as-is (requireAnyPermission already exists)
└── tests/integration/
    ├── tenant-team-list.test.ts               # org-wide + department-scoped visibility, search, pagination
    ├── tenant-team-list-permission-gating.test.ts
    └── tenant-team-member-detail-fields.test.ts

apps/web/
└── app/(dashboard-shell)/
    ├── layout.tsx                              # widen "Members" nav visibility to also include
    │                                           # team.view.all/team.view.department, not just
    │                                           # manage_team_members/team.create
    └── settings/team/
        └── team-settings-client.tsx            # extend existing Team screen with the directory list

packages/ui/src/
└── pagination.tsx                             # new: small reusable "X–Y of Z" + prev/next primitive
```

**Structure Decision**: The new list route is added to the existing `tenant-team-routes.ts` file
(same resource, same permission family) rather than a new file, mirroring how Roles' and
Department's own list/mutate routes already coexist in one file per resource. A small new
`team-visibility.ts` helper isolates the "resolve viewer's scope" logic (own department + its
subtree via the existing `collectSubtreeIds`) so the route handler itself stays thin and the logic
is independently unit-testable. The frontend extends the existing `settings/team` screen (already
housing the add-member form) rather than creating a second "Members" route, since the spec's own UI
section describes one unified screen with both the add-member action and the directory together.

## Complexity Tracking

*No Constitution Check violations — table not needed.*
