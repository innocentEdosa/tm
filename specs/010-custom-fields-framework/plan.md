# Implementation Plan: Extensible Custom Fields Framework

**Branch**: `010-custom-fields-framework` | **Date**: 2026-07-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-custom-fields-framework/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Three new tables (`form_definitions`, `form_fields`, `custom_field_values`) give any module a way to
render developer-fixed system fields alongside admin-configured custom fields, without inventing its
own ad-hoc "extra fields" mechanism. `form_definitions` is seeded once via migration (`department` is
the only row — Training Needs Analysis has no spec yet); no runtime path, Super Admin or tenant, can
ever create one. `form_fields` introduces this codebase's first *dual-visibility* RLS shape — a global
field (`tenant_id IS NULL`, Super-Admin-authored) is readable by every tenant but writable by none;
each tenant's own fields are fully theirs. This composes three already-independently-precedented RLS
techniques (the standard `tenant_isolation` policy, `0018`'s additive read-only-allowance-policy
pattern, and the already-wired-but-never-yet-used `app.is_super_admin` allowance clause) rather than
inventing a new mechanism. Generic, form-type-agnostic routes serve the merged field list, values, and
tenant-scoped field CRUD; per this spec's own Clarification, Department's already-shipped (Spec 009)
create/edit drawer is retrofitted to actually render and save through this framework, giving it one
real, demoable consumer. A new top-level "Settings" sidebar section (peer to "Administration") houses
the relocated Authentication Settings and the new Forms configuration screen — no route changes, so no
redirect logic is actually needed (Assumptions). No new npm dependency: field-key slugification is a
small inline string transform, and drag-to-reorder uses native HTML5 drag events, not a library.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 20, CommonJS output — unchanged, matches every other
backend feature in this repo.

**Primary Dependencies**: Fastify 5, Drizzle ORM (existing); `request.tenantDb`/`requirePermission`/
`requireTenantUserSession` (existing, reused as-is). `request.superAdminDb` (existing, from the Super
Admin Authentication spec) is read from for the first time by an actual RLS policy in this spec — it
has been set on every Super Admin request since that spec shipped, but until now no table's policy
ever referenced `app.is_super_admin` in a `USING`/`WITH CHECK` clause (research.md §1).

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. Field-key
generation from a label is a small inline slugify function (lowercase, replace non-alphanumerics with
`_`, no package needed). Drag-to-reorder among a tenant's own fields uses the browser's native
`draggable`/`dragstart`/`dragover`/`drop` events — the same "smallest sufficient built-in mechanism"
choice already made for `Modal`/`Drawer` in Spec 009, not a new drag-and-drop library.

**Storage**: PostgreSQL — Neon in production/staging, the existing local Docker Postgres 16 container
in development. Same connection/pooling model as every other tenant-scoped table.

**Testing**: Vitest (existing dev dependency). Integration tests run against a real Postgres
connection, mirroring Spec 009's convention — the dual-visibility RLS policy in particular cannot be
verified as "actually enforced, not just assumed" using mocks.

**Target Platform**: Linux server (Railway, existing Dockerfile/`railway.json`) — unchanged.

**Project Type**: Web application (existing pnpm/Turborepo monorepo) — this feature adds no new
top-level project.

**Performance Goals**: No hard SLA specified. Working assumption: rendering a form's merged field list
should add no more than low-single-digit milliseconds to that form's own load, achievable via one
indexed query per render (no N+1 across global vs. tenant fields) — the same working-assumption
posture Spec 001/009 already took.

**Constraints**: A tenant admin must never be able to edit, delete, or reorder a global (`tenant_id
IS NULL`) field via any path, including a direct API call — enforced by the dual-visibility RLS policy
itself (research.md §1), not merely hidden in the UI. Field-key uniqueness must hold across both the
global and tenant scopes for a given form type, which the literal `(tenant_id, form_definition_id,
field_key)` unique index (as specified) cannot fully guarantee on its own because Postgres treats a
`NULL` `tenant_id` as distinct from any real tenant UUID — closed at the application layer
(research.md §2), not by changing the specified schema shape.

**Scale/Scope**: Assumption, consistent with an admin-configured field list: on the order of single
digits to low tens of custom fields per form type per tenant, not hundreds — sized for a plain list UI
with native drag-reorder, no virtualization or pagination.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Tenant isolation is a security requirement | **PASS** | `custom_field_values` uses the standard single tenant_isolation policy; `form_fields`'s dual-visibility policy is scoped so a tenant can only ever *write* rows carrying its own `tenant_id` — global (`NULL`) rows are readable, never writable, by any tenant session (research.md §1). |
| II. Tenant provisioning includes org structure | N/A | This spec touches form/field configuration, not org structure (departments/roles) directly. |
| III. Forms/flows are tenant-configurable | **PASS** | This spec *is* the general mechanism Principle III calls for — every form type built on it gets tenant-configurable fields on top of platform-fixed defaults, instead of each module inventing its own. |
| IV. Spec-before-code | **PASS** | Follows the ratified, clarified spec; the one real ambiguity found in planning (the literal unique constraint not catching cross-scope key collisions) is resolved here explicitly, not silently patched in code. |
| V. Design system (locked) | **PASS** | Settings > Forms reuses `Card`/`Badge`/`Drawer`/`Toggle` from `packages/ui` (Spec 008/009) — the field builder is a `Drawer`, matching Department's own create/edit pattern; no new visual style introduced. |
| VI. Plan-tier awareness | N/A (deferred) | Whether custom fields become tier-gated is an open packaging question (spec Assumptions), not decided here; v1 ships available at every tier. |
| VII. White-labeling & structural customization | **PASS** | Tenant-specific fields are fully tenant-runtime-configurable; nothing tenant-specific is hardcoded into shared code. |
| VIII. Comprehensive-version rule | **PASS** | The cross-scope field-key collision gap (§ above) is flagged and closed with an application-layer check, not silently left as a smaller, incomplete guarantee. |
| IX. Demoable vs. internal | **PASS** | Demoable end-to-end via Department's retrofitted form (spec Clarification), not just the framework's own test harness. |
| X. Clean branch per feature | **PASS** | Branch `010-custom-fields-framework` created from a clean, up-to-date `master`. |
| XI. Stack is fixed (Next.js/Fastify) | **PASS** | Only Fastify and Next.js used; no alternative framework. |
| XII. Prefer built-in/native utilities | **PASS** | Native HTML5 drag events instead of a drag-and-drop library; a one-line slugify instead of a slug package. |
| XIII. No new package without explicit permission | **PASS — N/A, none requested** | Zero new npm packages needed. |

No unresolved `[NEEDS CLARIFICATION]` markers remain in Technical Context.

## Project Structure

### Documentation (this feature)

```text
specs/010-custom-fields-framework/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
│   └── custom-fields-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

Existing pnpm/Turborepo monorepo — no new top-level project. Extends `apps/api`, `apps/web`, and
`packages/ui` in place, following the exact module/route/page conventions Specs 001–009 established:

```text
apps/api/
├── src/
│   ├── db/schema/
│   │   └── custom-fields.ts        # new — form_definitions, form_fields, custom_field_values
│   └── custom-fields/               # new module, mirrors src/departments/
│       ├── field-validation.ts       # new — validate a submitted value against field_type/is_required;
│       │                             #       slugify(label) -> suggested field_key
│       ├── field-key-uniqueness.ts   # new — cross-scope (global+tenant) key-collision check
│       │                             #       (research.md §2 — the literal unique index alone can't)
│       ├── tenant-form-routes.ts     # new — GET form-definitions, GET/POST/PATCH/DELETE form-fields,
│       │                             #       GET/PUT custom-field-values
│       └── save-values.ts           # new — saveCustomFieldValues(tenantDb, formKey, entityId, values,
│                                     #       fields) — called directly by tenant-form-routes.ts AND by
│                                     #       tenant-department-routes.ts, same transaction, no HTTP hop
├── drizzle/                          # new migrations appended (schema + dual-visibility RLS + grants
│                                      # + seed `department` form_definition)
└── tests/integration/
    ├── custom-fields-global-field-locked.test.ts        # new
    ├── custom-fields-key-collision-cross-scope.test.ts  # new
    ├── custom-fields-render-merge-order.test.ts         # new
    ├── custom-fields-archive-preserves-values.test.ts   # new
    └── custom-fields-department-integration.test.ts     # new — Department's retrofitted form, E2E

apps/web/
└── app/(dashboard-shell)/settings/
    ├── forms/
    │   ├── page.tsx                       # new — Server Component route guard (mirrors
    │   │                                  #        settings/department/page.tsx)
    │   └── forms-settings-client.tsx      # new — form-type list, field config view, field builder
    │                                       #        drawer, native-drag reorder among tenant fields
    ├── department/department-settings-client.tsx  # existing — gains a custom-fields section in its
    │                                                #            Create/Edit drawer (spec FR-015)
    └── authentication/                    # existing — unchanged route, only its nav location moves
apps/web/app/(dashboard-shell)/layout.tsx  # existing — gains a new top-level "Settings" nav section
                                            #            (Authentication + Forms), Authentication
                                            #            removed from footerEntries

apps/api/src/departments/tenant-department-routes.ts  # existing — POST/PATCH gain an optional
                                                        # customFieldValues body field, saved via
                                                        # save-values.ts inside the same transaction
```

**Structure Decision**: Extend `apps/api`, `apps/web`, and `packages/ui`'s existing conventions in
place — no new package, no new service, no new top-level directory. The framework is generic
(`formKey`-parameterized), with Department as its one wired-up consumer per this spec's Clarification.

## Complexity Tracking

> No constitution violations require justification. The items below are scope-boundary/design
> judgment calls surfaced during planning, recorded here for traceability.

| Item | Why Needed | Simpler Alternative Rejected Because | Status |
|------|------------|---------------------------------------|--------|
| Application-layer cross-scope field-key uniqueness check, beyond the spec's own literal `(tenant_id, form_definition_id, field_key)` unique index | Postgres treats a `NULL` `tenant_id` as distinct from any real tenant UUID, so the literal constraint as specified cannot by itself stop a tenant from picking a key that collides with an existing *global* field (or vice versa) — a real gap against spec FR-005/SC-003 | Leaving the DB constraint as the only guard was rejected — it would silently violate the spec's own stated acceptance criterion; changing the specified schema shape instead of adding an application check was rejected as an unnecessary deviation from the given data model | Resolved — see research.md §2 |
| `form_fields`'s dual-visibility RLS policy is this codebase's first real use of the `app.is_super_admin` allowance clause in a `USING`/`WITH CHECK` (every prior table either ignores it entirely or, in `0018`, used a narrower single-purpose flag for a lookup, not this general shape) | Spec FR-002 requires the data model to support Super Admin authoring of global fields even though that UI is out of scope here; RLS is this codebase's only enforcement mechanism (no `BYPASSRLS` role is used anywhere) | A dedicated `BYPASSRLS` role for Super Admin was not considered — it would contradict the codebase's own established "no BYPASSRLS" stance (`drizzle/README.md`); the `app.is_super_admin` clause was already wired for exactly this future use, so using it now is completing a plan already laid, not a new mechanism | Resolved — see research.md §1 |
| Field deletion always archives, never hard-deletes (no conditional "if it has values" branch) | The feature request flagged needing an explicit "archive vs. hard-delete" decision; always-archive is simpler than a conditional path and can never accidentally lose data regardless of whether values existed at delete time | A conditional hard-delete-when-no-values-exist path was considered and rejected as unnecessary complexity for a benefit (reclaiming a handful of unused rows) the spec never actually asks for | Resolved — see research.md §7 |
