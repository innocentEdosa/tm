# Implementation Plan: Training Request Rename

**Branch**: `020-training-request-rename` | **Date**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/020-training-request-rename/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Pure rename of Feature 014's "Training Needs Analysis" feature to "Training Request" — no schema,
data, or business-logic change. Three coupled surfaces move together in one release: (1) all
user-facing copy (nav label, page headers, form/breadcrumb/toast text, notification templates) in
`apps/web`; (2) the frontend route from `apps/web/app/(dashboard-shell)/learning/tna/**` to
`.../learning/training-requests/**`, with a Next.js config-level redirect from the old path so
existing bookmarks/links keep working; (3) the five permission keys gating the feature
(`tna.view.all`, `tna.view.department`, `tna.manage.all`, `tna.manage.department`, `tna.approve`)
renamed to `training_request.*` equivalents. The permission rename is safe by construction: both
`role_permissions` and `role_template_permissions` reference `permissions.id` (a stable UUID), not
the `key` string (`apps/api/src/db/schema/roles.ts`, `permissions.ts`), so a single in-place
`UPDATE permissions SET key = ...` migration relabels the five rows without touching any existing
grant. Deliberately **not** touched (per spec Assumptions, explicit scope boundary): the
`training_needs` DB table name/columns, the `apps/api/src/training-needs/` module directory, the
`apps/web/.../tna/` component file names, and the backend API route prefix
(`/tenant/training-needs`) — these are internal identifiers, not user-facing, and are flagged as a
separate future decision.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 20 — unchanged, no new language/runtime surface.

**Primary Dependencies**: Fastify 5, Drizzle ORM (existing, `apps/api`); Next.js 15 App Router,
React 19, `@tm/ui` (existing, `apps/web`). Reused as-is: `requirePermission`/`requireAnyPermission`
(`apps/api/src/permissions/require-permission.ts`), the existing `permissions`/`role_permissions`/
`role_template_permissions` tables. No new route, component, or table is introduced — every touched
file already exists from Feature 014.

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. This is a
label/identifier rename; Next.js's built-in `redirects()` config covers the old-path-redirect
requirement (FR-006) with no added package.

**Storage**: PostgreSQL (Neon prod/staging, local Docker dev) — unchanged. One new migration that
`UPDATE`s five existing rows in the `permissions` table (no `CREATE`/`ALTER TABLE`, no RLS change).

**Testing**: Vitest (existing). Six existing integration test files reference the old `tna.*`
permission-key literals and must be updated to the new keys as part of this change:
`training-needs-visibility.test.ts`, `training-needs-approval.test.ts`,
`training-needs-permission-gating.test.ts`, `seed-default-roles.test.ts`,
`provision-tenant-admin-role.test.ts`, `custom-fields-tna-integration.test.ts`. A new integration
test asserts the migration's safety property directly (seed a role with the old keys pre-migration,
assert equivalent access post-migration).

**Target Platform**: Linux server (Railway) — unchanged.

**Project Type**: Web application (existing pnpm/Turborepo monorepo, `apps/api` + `apps/web`) — no
new top-level project.

**Performance Goals**: N/A — no query shape, index, or data-volume change. The rename touches only
string literals, one config redirect rule, and UPDATE statements on 5 fixed rows.

**Constraints**: The permission-key rename in the database and the code that checks for the new key
names MUST deploy atomically (same release) — a window where API code checks for
`training_request.*` while the database still stores `tna.*` (or vice versa) would incorrectly deny
every user of the feature (spec Edge Cases). The migration itself must be a `key`-column `UPDATE`,
never a delete-and-reinsert (spec FR-005) — reinserting would orphan every existing
`role_permissions`/`role_template_permissions` row pointing at the old `permissions.id`.

**Scale/Scope**: Every existing tenant with any role holding one or more of the five `tna.*`
permissions (unbounded — could be all tenants that use the feature) is affected by the permission
migration; each is verified via the before/after grant-equivalence check in quickstart.md.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Tenant isolation is a security requirement | **PASS** | No change to `training_needs`'s existing `tenant_isolation` RLS policy or any tenant-scoped query. The permission migration operates on the platform-shared `permissions` table (not tenant-scoped) by design — same table every other permission key already lives in. |
| II. Tenant provisioning includes org structure | N/A | No department/role/template structure introduced or altered — only existing permission *labels* change. |
| III. Forms and flows are tenant-configurable | **PASS** | No change to the tenant-configurable custom fields (Custom Fields Framework, Spec 010) attached to this form (spec FR-008). Which roles hold which of the five permissions remains exactly as tenant-configured before the rename (spec FR-005, Constitution Alignment). |
| IV. Spec-before-code | **PASS** | This plan follows a completed spec (`spec.md`) with a `/speckit-clarify` pass that found no unresolved ambiguities. |
| V. Design delegated to UI-UX-Pro-Max, then locked | **PASS** | No new screens, components, or styles — every touched page reuses its existing `@tm/ui` markup verbatim with only copy and route-segment changes. |
| VI. Every module is plan-tier aware | **PASS (no change)** | This rename does not alter Feature 014's existing tier-gating posture (or lack thereof); out of scope for this spec. |
| VII. White-labeling and structural customization go together | **PASS** | No branding or structural-customization surface touched. |
| VIII. Comprehensive-version rule | **PASS** | The old-route-redirect requirement (FR-006) and the in-place (not delete/reinsert) migration requirement (FR-005) both exist specifically because the spec chose the safer, more complete option over a silently narrower one, per this principle. |
| IX. Demoable vs. internal work is explicit | **PASS** | Spec states this is demoable — the renamed labels are directly visible to end users. |
| X. Every feature starts in a clean-tree new branch | **NOTE** | `setup-plan.sh` reported an empty `BRANCH` — no `before_plan`/`before_specify` git hook is configured (`.specify/extensions.yml` does not exist). No branch has been created yet for this feature. Recommend creating `020-training-request-rename` from a clean `master`/base branch before `/speckit-implement` begins. |
| XI. Stack is fixed: Next.js + Fastify | **PASS** | No new framework/runtime; uses Next.js's built-in `redirects()` for FR-006. |
| XII. Prefer built-in/native utilities | **PASS** | Next.js config-level redirects (built-in) satisfy the old-link requirement; no redirect/rewrite package added. |
| XIII. No new package without permission | **PASS** | None requested; none needed. |

**Post-Phase 1 re-check**: Design artifacts (research.md, data-model.md, contracts/, quickstart.md)
introduce no schema change, no new dependency, and no new violation. The only open item remains
Principle X's flagged branch note above, unchanged from Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/020-training-request-rename/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── permission-keys.md
│   └── frontend-routes.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
apps/api/
├── drizzle/
│   └── 0064_rename_tna_permissions_to_training_request.sql   # UPDATE permissions SET key = ... (5 rows), in place
├── src/
│   ├── training-needs/
│   │   ├── tenant-training-needs-routes.ts       # edited: ~15 string-literal permission-key occurrences renamed
│   │   └── training-need-visibility.ts           # edited: comment references to tna.* keys updated
│   └── db/schema/
│       └── training-needs.ts                     # edited: doc comment only (tna.approve -> training_request.approve); table/columns unchanged
└── tests/integration/
    ├── training-needs-visibility.test.ts          # edited: tna.* literals -> training_request.*
    ├── training-needs-approval.test.ts             # edited: same
    ├── training-needs-permission-gating.test.ts    # edited: same
    ├── seed-default-roles.test.ts                  # edited: same
    ├── provision-tenant-admin-role.test.ts          # edited: same
    ├── custom-fields-tna-integration.test.ts        # edited: same
    └── training-request-permission-migration.test.ts  # new: seeds old tna.* grants pre-migration, asserts equivalent training_request.* access post-migration

apps/web/
├── next.config.ts                                  # edited: redirects() entry, old /learning/tna/:path* -> /learning/training-requests/:path*
└── app/(dashboard-shell)/
    ├── layout.tsx                                    # edited: nav label "Training Requests", permission checks renamed, href updated
    └── learning/
        └── training-requests/                        # renamed from tna/ (directory move, not new)
            ├── page.tsx
            ├── training-needs-client.tsx               # copy updated; file kept in place (internal name, deferred per spec Assumptions)
            ├── training-need-form.tsx                  # copy updated; file kept in place
            ├── new/page.tsx
            └── [id]/
                ├── page.tsx
                ├── edit/page.tsx
                └── training-need-view.tsx              # copy updated; file kept in place
```

**Structure Decision**: No new module or app is introduced. This is a directory move
(`learning/tna/` → `learning/training-requests/`) plus in-place copy/string edits across the exact
files Feature 014 already created, plus one new migration and one new migration-safety test. Per
the spec's explicit scope boundary, internal file names inside the moved directory
(`training-need-form.tsx`, `training-needs-client.tsx`, `training-need-view.tsx`), the backend
`training-needs/` module directory, the API route prefix (`/tenant/training-needs`), and the
`training_needs` DB table are left unrenamed — only the top-level route segment users navigate to,
the permission keys, and all user-facing copy change.

## Complexity Tracking

*No Constitution Check violations — this section is intentionally empty.*
