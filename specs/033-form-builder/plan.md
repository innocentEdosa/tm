# Implementation Plan: Reusable Form Builder & Form Renderer

**Branch**: `033-form-builder` | **Date**: 2026-08-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/033-form-builder/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Evolve the existing Extensible Custom Fields Framework (spec 010) into a versioned, multi-step,
multi-column Form Builder: Super Admin creates form types and publishes versioned form
definitions at runtime (no migration per new form type); Tenant Admins extend a published form
with tenant-only fields and may hide (never delete) optional platform fields; every consuming
feature retrieves one resolved "effective form" and renders it with a single shared
`<FormRenderer>` — eliminating the three duplicated `render*Field()` switches found in the prior
audit (Department, Member, Training Needs Analysis). Extends existing tables
(`form_definitions`, `form_fields`, `form_field_order_overrides`, `custom_field_values`) with new
`form_versions`/`form_steps`/`form_sections` tables and a new `packages/form-builder`
(`@tm/form-builder`) package, following the merge-at-read-time model already proven by
`getFormFields()` rather than the course-marketplace clone-at-acquisition pattern.

## Technical Context

**Language/Version**: TypeScript, Node.js (per existing `apps/api`/`apps/web`, no version change)

**Primary Dependencies**: Fastify (API), Next.js 15 / React 19 (web), Drizzle ORM + PostgreSQL
(`apps/api/src/db`), `@tanstack/react-query` (data fetching), `@dnd-kit/core` +
`@dnd-kit/sortable` + `@dnd-kit/utilities` (already an `apps/web` dependency, already used for
reorderable UI in `curriculum-tab.tsx` — reused for the builder's drag-and-drop canvas), `@tm/ui`
(shared design-system package: `Card`, `Drawer`, `Modal`, `Button`, `Input`, `Toggle`, `Badge`,
`PageHeader`, `Popover`).

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. Every
capability required (drag-and-drop reordering, forms, dialogs, design tokens) is already covered
by dependencies already installed and already in production use elsewhere in this monorepo — see
research.md §2 for the specific evidence per capability.

**Storage**: PostgreSQL, shared schema + Row-Level Security (existing tenant-isolation model,
`apps/api/src/db/schema/*`, migrations in `apps/api/drizzle/*.sql` applied via Drizzle Kit).

**Testing**: Existing `apps/api/tests/{unit,integration}` (Node test runner per repo convention)
for backend logic; component/interaction tests for `packages/form-builder` co-located with the
package per the monorepo's existing testing conventions (verified during Phase 0 research —
see research.md §7).

**Target Platform**: Server (Fastify API, Linux/Docker per `docker-compose*.yml`) + browser
(Next.js web app), no new platform surface.

**Project Type**: Web application monorepo (existing `apps/api` + `apps/web` + `packages/*`
pnpm/turborepo structure) — this feature adds one new shared package plus additive changes to
the existing `apps/api` and `apps/web` apps.

**Performance Goals**: No new performance targets beyond existing conventions — effective-form
resolution is a request-scoped read (a handful of indexed queries, matching `getFormFields()`'s
existing cost profile) with no batch/background processing introduced.

**Constraints**: Must not require any tenant to reconfigure anything that already works (FR-033);
must not introduce any window where two versions of the same form are simultaneously active
(FR-008); every isolation/ownership rule enforced server-side, not only in the UI (FR-024).

**Scale/Scope**: 3 existing form types migrated (Department, Member, Training Needs Analysis)
plus unbounded future form types created by Super Admin at runtime; single-digit-to-dozens of
fields per form is the expected common case, consistent with existing usage.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|---|---|---|
| I. Tenant Isolation | Every new table (`form_versions`, `form_steps`, `form_sections`) and every extended column is either platform-global (no `tenant_id`, Super-Admin-write-only via `super_admin_full_access` RLS, matching 6+ existing precedents) or tenant-scoped under the existing `tenant_isolation` RLS policy shape. No query in this feature reads/writes across tenants without going through these policies. | **PASS** |
| II. Provisioning includes org structure | N/A — this feature doesn't touch tenant provisioning. | **N/A** |
| III. Forms/flows are tenant-configurable | This feature *is* the direct implementation of this principle at the platform layer — see spec's Constitution Alignment section. | **PASS (implements)** |
| IV. Spec-before-code | This plan follows `specs/033-form-builder/spec.md`, produced via `/speckit-specify` before any code. | **PASS** |
| V. Design decisions via UI-UX-Pro-Max, then locked | No new visual language introduced — reuses the established `@tm/ui` design system exclusively (research.md §2). | **PASS** |
| VI. Plan-tier awareness | Not addressed by this spec (carried forward as an open packaging question from spec 010, per spec's Constitution Alignment) — no plan-tier gate is bypassed by this feature; none exists today for this surface. | **N/A (deferred, documented)** |
| VII. White-labeling & structural customization | Consistent — extends the existing per-tenant structural customization model rather than introducing a parallel one. | **PASS** |
| VIII. Comprehensive-version rule | Spec deliberately scopes all 6 user stories from the full request rather than narrowing silently; phasing is handled via priority order (P1–P6), not scope reduction. | **PASS** |
| IX. Demoable vs. internal | Spec states this is demoable (Super Admin building/publishing a form, Tenant Admin extending it). | **PASS** |
| X. Clean branch per feature | Working tree was clean at spec creation (see gitStatus at session start). | **PASS** |
| XI. Stack is fixed (Next.js/Fastify) | No new framework/runtime proposed. | **PASS** |
| XII/XIII. No new dependency without justification/sign-off | Zero new packages required (see Technical Context above); nothing to seek sign-off for. | **PASS** |

No violations requiring the Complexity Tracking table.

**Post-Design Re-check** (after Phase 1 artifacts below): the one notable design decision —
reopening `INSERT`/`UPDATE` grants on `form_definitions` (research.md §5) — is paired with a
`super_admin_full_access` RLS policy identical in shape to 6+ existing tables, so Principle I
(tenant isolation) still holds with no new exposure. No other design choice in research.md/
data-model.md/contracts/ introduces a gate violation beyond what's already listed above.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
apps/api/
├── src/
│   ├── db/schema/
│   │   ├── custom-fields.ts        # EXTENDED: form_definitions, form_fields,
│   │   │                           #   form_field_order_overrides, custom_field_values
│   │   └── form-builder.ts         # NEW: form_versions, form_steps, form_sections
│   ├── custom-fields/              # EXISTING, reused as-is:
│   │   ├── field-validation.ts     #   validateFieldValue, slugify
│   │   ├── save-values.ts          #   validateCustomFieldValues, saveCustomFieldValues
│   │   └── field-key-uniqueness.ts #   collision checks
│   └── form-builder/               # NEW module
│       ├── get-effective-form.ts   # getEffectiveForm() — the merge/resolution engine
│       ├── platform-form-routes.ts # Super Admin: form types, versions, publish
│       └── tenant-form-builder-routes.ts # Tenant: effective form, extend, hide/reorder
├── drizzle/
│   └── 0107_*.sql …                # additive migrations, see data-model.md
└── tests/
    ├── unit/form-builder/
    └── integration/form-builder/

packages/form-builder/              # NEW package: @tm/form-builder
├── package.json                    # follows @tm/ui's no-build, src-as-main convention
└── src/
    ├── components/
    │   ├── FormRenderer/           # the shared renderer (core deliverable)
    │   ├── FormBuilder/            # visual canvas (dnd-kit-based)
    │   └── FormPreview/            # thin FormRenderer wrapper, read-only mode
    ├── fields/                     # one component per field type
    ├── hooks/
    │   └── use-effective-form.ts
    ├── types/
    └── index.ts                    # public API only

apps/web/app/
├── (dashboard-shell)/settings/
│   ├── forms/forms-settings-client.tsx   # EXTENDED for step/section/hide UI
│   ├── department/department-settings-client.tsx  # MIGRATED: renderSystemField/
│   │                                                #   renderCustomField removed
│   ├── team/team-settings-client.tsx     # MIGRATED (User Story 4)
│   └── ...
├── (dashboard-shell)/learning/training-requests/
│   └── training-need-form.tsx            # MIGRATED (User Story 4)
└── (platform-shell)/forms/               # NEW: Super Admin Form Builder screens
    └── ...
```

**Structure Decision**: Existing monorepo layout (`apps/api` Fastify backend, `apps/web` Next.js
frontend, `packages/*` shared libraries) is unchanged in shape — this feature adds one new
package (`packages/form-builder`) and one new backend module (`apps/api/src/form-builder/`),
extends one existing schema file and adds one new one, and touches existing consumer pages
in-place. No new app, no new repo, no new deployment target.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
