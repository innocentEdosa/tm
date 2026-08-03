# Implementation Plan: Course Marketplace

**Branch**: `029-course-marketplace` | **Date**: 2026-07-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/029-course-marketplace/spec.md`

## Summary

Add a Super-Admin-authored, platform-level course catalog (`platform_courses` /
`platform_course_modules` / `platform_course_content_items` / `platform_file_attachments` — no
`tenant_id`, no RLS, gated entirely by `requireSuperAdminSession`) that mirrors the shape of the
existing tenant-scoped `courses`/`course_modules`/`content_items`/`file_attachments` tables from specs
023–027. A new tenant-facing marketplace surface (gated by the existing `course.manage` permission)
lets a tenant browse `active` platform courses and select one. Selecting a free course clones it
immediately (metadata rows duplicated into the tenant's own course tables; file attachments cloned as
new rows that reference the *same* R2 `storage_key`, never a duplicated object) via a shared
`clonePlatformCourseIntoTenant` function. Selecting a paid course instead creates a `tenant_id`-scoped
`marketplace_selections` record (RLS `tenant_isolation` + `super_admin_full_access`, mirroring
`tenants`/`user_sessions`) that a Super Admin later resolves; resolving as `paid` runs the same clone
function against a dedicated pooled connection with `app.tenant_id` pinned to the target tenant —
exactly the pattern `provisionTenant` already uses to write into a specific tenant's RLS-protected
tables from a Super-Admin-triggered flow. No payment processor is integrated. New UI ships on both
sides (Super Admin authoring, tenant browse/select), unlike specs 023–025/027 which were API-only.

## Technical Context

**Language/Version**: TypeScript 5.x / Node 20, matching every existing `apps/api`/`apps/web` module —
unchanged from specs 023–027.

**Primary Dependencies**: Fastify 5, Drizzle ORM 0.45 + drizzle-kit 0.31, Next.js (App Router) —
existing `request.tenantDb`, `request.superAdminDb`, `fastify.db`, `requireTenantUserSession`,
`requirePermission`/`requireAnyPermission`, `requireSuperAdminSession`, the existing `StorageClient`
(`apps/api/src/storage/storage.ts`, R2 presigned-URL flow from spec 025), and the existing SCORM
manifest-import logic (spec 027) — all already in place, no new library.

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. This spec
reuses spec 025's already-approved `@aws-sdk/client-s3`/`@aws-sdk/s3-request-presigner` indirectly
through the existing `StorageClient` abstraction — no new package, no new external service.

**Storage**: PostgreSQL (existing shared instance) — four new tables with no `tenant_id`
(`platform_courses`, `platform_course_modules`, `platform_course_content_items`,
`platform_file_attachments`; no RLS, Super-Admin-only access enforced at the route layer), one new
`tenant_id`-scoped table (`marketplace_selections`; RLS with both `tenant_isolation` and
`super_admin_full_access` policies), and one constraint change on the existing `file_attachments` table
(drop `file_attachments_storage_key_unique` — research.md §1). Cloudflare R2 (existing, from spec 025)
for file bytes — no new object-storage path; cloning never re-uploads, it only creates a new
`file_attachments`/`platform_file_attachments` row pointing at an existing `storage_key`.

**Testing**: Vitest, new integration test files under `apps/api/tests/integration/course-marketplace-*.test.ts`
and `platform-course-*.test.ts`, mirroring the `course-*.test.ts` / `course-content-*.test.ts`
convention from specs 023/024. For the two new web surfaces, real-browser verification via
`claude-in-chrome` (not just `.inject()`-based API tests) is required before considering either UI
screen done, per the documented Super Admin cross-origin-cookie lesson.

**Target Platform**: Linux server (existing `apps/api` Fastify deployment) + existing Next.js
deployment — no platform change.

**Project Type**: Web application (existing Next.js + Fastify monorepo). Unlike specs 023–025/027, this
spec touches both `apps/api` **and** `apps/web` — new UI on both the Super Admin (`(platform-shell)`)
and tenant (`(dashboard-shell)`) sides.

**Performance Goals**: A clone operation (course + modules + content items + attachment rows) completes
as a single transaction with no perceptible delay for a platform course of typical size (tens of
modules/items, matching spec 024's SC-005 scale assumption) — no new performance regime, since cloning
is row-copying at the same scale spec 024 already validated for curriculum reads.

**Constraints**: Tenant isolation enforced server-side on every tenant-scoped row regardless of client
input (Principle I) — platform tables have no tenant dimension to isolate, so their protection is
entirely at the route/session layer (`requireSuperAdminSession`), not RLS; this is a deliberate,
explicitly-justified deviation from "every table carries `tenant_id`," documented in Constitution
Check below. A clone MUST NOT duplicate an R2 object (spec SC-005) and MUST NOT allow more than one
non-`rejected` selection per tenant/platform-course pair (spec FR-009) — enforced by a partial unique
index, not application-layer-only logic.

**Scale/Scope**: ~14 new API routes (platform-course CRUD/curriculum/file-upload authoring; tenant
marketplace browse/detail/select; Super-Admin selection-queue list/resolve) across three new route
files; five new tables (four platform-level, one tenant-scoped); two new `apps/web` route groups
(Super Admin authoring pages, tenant browse/select pages); zero new tenant permission keys.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (Tenant Isolation)**: PASS, with one explicitly-justified deviation. The five new
  tenant-scoped-in-spirit entities split into two groups: `marketplace_selections` carries `tenant_id`
  and gets the standard `tenant_isolation` RLS policy (identical to every prior tenant table) plus a
  second, OR'd `super_admin_full_access` policy for the cross-tenant Super Admin queue read — the exact
  precedent already established for `tenants`/`user_sessions` (research.md §3). The four
  `platform_*` tables intentionally carry **no** `tenant_id` and **no** RLS at all, because they hold no
  tenant's data — they are the platform's own catalog, analogous to the already-existing
  RLS-free `permissions`/`role_templates`/`course_category_templates` tables, not a new pattern. Every
  write to them requires `requireSuperAdminSession`; every tenant-facing read of them is a narrow,
  explicitly-filtered (`status = 'active'`) query, never a raw pass-through. The clone operation's
  *output* — rows written into a tenant's own `courses`/`course_modules`/`content_items`/
  `file_attachments` — is fully `tenant_id`-scoped and RLS-protected exactly like tenant-authored data
  (research.md §2), so no cross-tenant leak is possible once a clone exists.
- **Principle II/III (Tenant-configurable, not fixed)**: PASS — no new tenant permission keys; a
  platform course's category is a plain name resolved into the *tenant's own* configurable category
  list via the existing `resolveOrCreateCourseCategory` (spec 023), unchanged.
- **Principle IV (Spec-Before-Code)**: PASS — spec.md resolved all five clarifying questions (data
  model, payment scope, content-access model, pricing shape, category resolution) before this plan;
  zero `NEEDS CLARIFICATION` markers remain in Technical Context.
- **Principle V (Design system)**: Applies — new UI on both sides. Both surfaces MUST be built via the
  `ui-ux-pro-max` skill against the established design system (research.md §7); flagged in spec
  Constitution Alignment already.
- **Principle VI (Plan-tier aware)**: PASS by explicit non-gating — no plan-tier mechanism exists
  anywhere in the codebase yet (grepped, none found), so this feature is available to all tenants; not
  silently assumed, stated in spec Assumptions.
- **Principle VII (White-labeling)**: N/A — no tenant branding surface touched.
- **Principle VIII (Comprehensive-version rule)**: Applied during spec scoping — platform course
  content items reuse the *current*, full content-item capability set (real file upload, real SCORM
  hosting/playback) rather than the narrower external-URL-only shape spec 024 originally shipped,
  since those capabilities now exist for the tenant-scoped equivalent this spec mirrors (spec
  Assumptions).
- **Principle IX (Demoable vs. internal)**: Stakeholder-demoable end to end (spec Constitution
  Alignment) — first course-catalog spec in this sequence with real UI.
- **Principle X (Clean branch)**: PASS — `029-course-marketplace` branched from a clean `master` (no
  uncommitted work, verified before branching).
- **Principle XI (Fixed stack)**: PASS — Fastify backend, Next.js frontend, no new runtime/framework.
- **Principle XII/XIII (No new dependency)**: PASS — "None" per Technical Context; every capability
  needed (R2 storage, SCORM import, presigned URLs) already exists from specs 025/027.

No violations. Complexity Tracking table below is empty.

## Project Structure

### Documentation (this feature)

```text
specs/029-course-marketplace/
├── plan.md                              # This file
├── research.md                          # Phase 0 output
├── data-model.md                        # Phase 1 output
├── quickstart.md                        # Phase 1 output
├── contracts/
│   ├── platform-course-authoring-api.md
│   └── course-marketplace-api.md
└── tasks.md                             # Phase 2 output (/speckit-tasks — not created by this command)
```

### Source Code (repository root)

```text
apps/api/
├── src/
│   ├── db/schema/
│   │   └── platform-courses.ts                    # NEW: platform_courses, platform_course_modules,
│   │                                                #      platform_course_content_items,
│   │                                                #      platform_file_attachments,
│   │                                                #      marketplace_selections
│   ├── platform-courses/
│   │   ├── platform-course-routes.ts               # NEW: Super Admin platform-course CRUD
│   │   ├── platform-course-content-routes.ts        # NEW: Super Admin module/content-item authoring
│   │   │                                             #      (reuses content-item-payload-validation.ts)
│   │   └── platform-course-file-routes.ts           # NEW: Super Admin file upload/attach
│   │                                                 #      (reuses storage.ts, scorm import logic)
│   ├── course-marketplace/
│   │   ├── tenant-marketplace-routes.ts             # NEW: tenant browse/detail/select
│   │   ├── admin-marketplace-selection-routes.ts     # NEW: Super Admin selection queue list/resolve
│   │   ├── clone-platform-course.ts                  # NEW: shared clone fn (both call sites use it)
│   │   └── platform-course-immutability.ts           # NEW: "has ≥1 fulfilled selection" guard (FR-013)
│   ├── db/
│   │   └── with-tenant-connection.ts                 # NEW: extracts provisionTenant's manual
│   │                                                  #      pooled-client/app.tenant_id pattern into
│   │                                                  #      a reusable helper (research.md §4) — this
│   │                                                  #      spec is its second call site
│   └── server.ts                                     # MODIFIED: register the five new route plugins
├── drizzle/
│   ├── NNNN_platform_course_tables.sql               # NEW: schema (drizzle-kit generate)
│   ├── NNNN_marketplace_selections_table.sql         # NEW: schema
│   ├── NNNN_rls_marketplace_selections.sql           # NEW: tenant_isolation + super_admin_full_access
│   ├── NNNN_lock_platform_course_grants.sql          # NEW: tm_app grants for all 5 new tables
│   └── NNNN_drop_file_attachments_storage_key_unique.sql  # NEW: relax existing constraint
└── tests/integration/
    ├── platform-course-authoring.test.ts                       # NEW (US1)
    ├── platform-course-content-authoring.test.ts                # NEW (US2)
    ├── course-marketplace-browse.test.ts                        # NEW (US3)
    ├── course-marketplace-select-free.test.ts                   # NEW (US4)
    ├── course-marketplace-select-paid-and-resolve.test.ts       # NEW (US5)
    └── course-marketplace-immutability-and-isolation.test.ts    # NEW (cross-cutting: FR-013, FR-005/012)

apps/web/
├── app/
│   ├── (platform-shell)/
│   │   └── admin/
│   │       └── course-marketplace/                    # NEW: Super Admin authoring pages
│   │           ├── page.tsx                            #   platform course list
│   │           ├── new/page.tsx                         #   create platform course
│   │           ├── [courseId]/page.tsx                   #   edit metadata + curriculum builder
│   │           └── selections/page.tsx                   #   pending paid-selection queue
│   └── (dashboard-shell)/
│       └── learning/
│           └── marketplace/                            # NEW: tenant browse/select pages
│               ├── page.tsx                             #   browse/search/filter list
│               └── [platformCourseId]/page.tsx            #   detail + select action
```

**Structure Decision**: Two new top-level `apps/api/src` directories — `platform-courses/` (Super
Admin authoring, mirroring `courses/` + `course-content/`'s split) and `course-marketplace/` (the
cross-cutting tenant-select/clone/resolve logic that doesn't belong to either the tenant or the
platform side alone). No new `apps/api` project. Two new `apps/web` route subtrees, one per existing
shell group (`(platform-shell)` for Super Admin, `(dashboard-shell)` for tenants) — no new shell, no
new top-level app. New migrations appended to the existing numbered sequence (next is `0092`).

## Complexity Tracking

*No unjustified Constitution Check violations — the one deviation (platform tables carry no
`tenant_id`/RLS) is explicitly justified above, not merely noted, so this table is intentionally
empty.*
