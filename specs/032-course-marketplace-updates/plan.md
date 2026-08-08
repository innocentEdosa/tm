# Implementation Plan: Course Marketplace Updates

**Branch**: `032-course-marketplace-updates` | **Date**: 2026-08-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/032-course-marketplace-updates/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Replaces the hard "frozen once cloned" restriction from specs/029-course-marketplace with a versioned
update-and-notify flow. A Super Admin can keep editing a platform course indefinitely; every
content-affecting edit increments a per-course `version` counter and, if any tenant already has a
fulfilled clone, emails every `course.manage` holder on that tenant and surfaces an "update available"
indicator. A tenant can apply the update (their cloned course/module/content-item rows are reconciled
in place against the platform's current content, matched by a newly-added stable source-id link so
existing `learner_content_progress` rows keep resolving unchanged) or dismiss it (no change, re-offered
on the next edit). File-backed content (course image, attachments) is never overwritten in place once
clones exist — every edit uploads a new R2 object, and old objects are preserved rather than deleted, so
a tenant who hasn't updated keeps seeing their original file.

## Technical Context

**Language/Version**: TypeScript (Node.js), same as the rest of `apps/api`/`apps/web` — no change.

**Primary Dependencies**: Fastify (API routes), Drizzle ORM + `pg` (Postgres access), `@aws-sdk/client-s3`
+ `@aws-sdk/s3-request-presigner` (R2/presigned URLs, already used by `storage/r2-client.ts`), Next.js
(tenant-facing UI). All already installed; no new dependency.

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. Every capability
this feature needs (version counters, a new join query, a new mailer function, a new reconciliation
function) is achievable with Drizzle/plain SQL and the existing mailer/storage abstractions already in
the codebase.

**Storage**: PostgreSQL (existing `platform_courses`, `marketplace_selections`, `course_modules`,
`content_items` tables, extended per data-model.md), Cloudflare R2 (existing `platform_file_attachments`/
`file_attachments` object storage, no new bucket or client).

**Testing**: Existing project test setup (see `apps/api`'s test scripts / CI config) — route-level and
function-level tests co-located the same way specs/029's tests are, covering: version increments on
every previously-frozen mutation type, the notify de-dupe logic (research.md §5), apply reconciling
matched/new/removed modules and content items correctly, dismiss/re-offer, and file-object preservation
(no `storage.deleteObject` call recorded for a cloned course's attachment replace/delete).

**Target Platform**: Same as the rest of the app — server-side Fastify API + Next.js web app, no new
target.

**Project Type**: Web application (existing `apps/api` backend + `apps/web` frontend monorepo) — no
structural change.

**Performance Goals**: No new performance target beyond "an authoring edit's added version-bump-and-notify
work does not make the edit noticeably slower for the Super Admin" — the notify routine only runs its
per-tenant email loop when ≥1 fulfilled selection exists (the common case, a course with zero clones, adds
one cheap `UPDATE ... SET version = version + 1` and nothing else).

**Constraints**: Must not delete any R2 object belonging to a platform course that has ≥1 fulfilled
selection (research.md §3) — a hard behavioral constraint, not a performance one. Must not modify
`learner_content_progress` as a side effect of applying an update (FR-007) — enforced by construction
(the reconciliation function never writes to that table at all).

**Scale/Scope**: Same order of magnitude as spec 029 — a handful to low hundreds of platform courses,
each cloned by up to the platform's total tenant count. No scale concern distinct from what 029 already
handles.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (Tenant Isolation)**: No change to the isolation model. `platform_courses`/
  `platform_course_modules`/`platform_course_content_items`/`platform_file_attachments` remain
  `tenant_id`-less, `requireSuperAdminSession`-gated only (as spec 029 established and its own
  Constitution Check justified). `marketplace_selections`' existing RLS (`tenant_isolation` +
  `super_admin_full_access`) is unchanged by adding three nullable/defaulted integer columns to it. The
  new `course_modules`/`content_items` columns are plain nullable FKs on already-RLS-protected tenant
  tables — no new cross-tenant read path is introduced; the version-bump-and-notify routine reads one
  specific tenant's `users`/`user_roles` only via the already-established `withTenantConnection`
  per-tenant-scoped pattern (research.md §6), never a broadened cross-tenant query. **PASS**.
- **Principle IV (Spec-Before-Code)**: This plan follows a written spec (spec.md) that already resolved
  its two significant product ambiguities (file versioning, learner-progress handling) via the user
  before writing began — nothing is being invented in code that wasn't decided in the spec. **PASS**.
- **Principle VI (Plan-Tier Awareness)**: Not applicable — this feature extends an existing
  Super-Admin/tenant capability (course marketplace) that spec 029 did not gate behind a plan tier, and
  nothing in this spec's scope introduces new tier-gated functionality. **N/A, consistent with 029's own
  Constitution Check reaching the same conclusion.**
- **Principle VIII (Comprehensive-Version Rule)**: Two tradeoffs are flagged rather than silently
  resolved to the simpler option: R2 storage growing unboundedly for repeatedly-edited, widely-cloned
  courses (research.md §3, garbage collection explicitly deferred), and pre-existing (pre-migration)
  cloned curriculum lacking a `source_...` link so its first post-migration update may duplicate rather
  than cleanly reconcile (data-model.md's migration/backfill note). Both are called out explicitly per
  this principle rather than hidden. **PASS**.
- **Principle X (Clean branch)**: Started from a clean `master` working tree on a new branch,
  `032-course-marketplace-updates`, not stacked on unmerged work. **PASS**.
- **Principles XI–XIII (Stack fixed, prefer built-ins, no unsigned-off installs)**: No new package.
  Fastify/Next.js/Drizzle stack unchanged. **PASS**.
- Quality Bar — "data model changes MUST state their tenant-isolation model impact": done above.
  "AI-generation review/approval step": N/A, no AI generation in this feature. "Kirkpatrick L4/L5 data
  source": N/A. "Downgrade/cancellation": N/A, not billing/security/evaluation. "New UI screen must
  reference the established design system": the tenant-facing update-available badge/apply/dismiss
  control and the Super Admin's now-unblocked edit UI (removal of "frozen" messaging) both extend
  existing screens (`apps/web/app/(dashboard-shell)/learning/courses/...`, the platform course editor)
  using the same design-system components already in use there — no new pattern introduced.

No violations requiring the Complexity Tracking table.

## Project Structure

### Documentation (this feature)

```text
specs/032-course-marketplace-updates/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/             # Phase 1 output (/speckit-plan command)
│   └── course-marketplace-updates-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
apps/api/
├── drizzle/
│   └── 0106_course_marketplace_updates.sql        # NEW — data-model.md's migration
├── src/
│   ├── db/schema/
│   │   ├── platform-courses.ts                    # MODIFIED — +version, +3 marketplace_selections columns
│   │   └── course-content.ts                       # MODIFIED — +2 source_platform_..._id columns
│   ├── course-marketplace/
│   │   ├── platform-course-immutability.ts         # MODIFIED — doc comment only; predicate reused, not removed
│   │   ├── clone-platform-course.ts                 # MODIFIED — +applyPlatformCourseUpdateToTenant export
│   │   ├── record-platform-course-change.ts         # NEW — version bump + notify routine (contracts §Internal)
│   │   ├── course-update-mailer.ts                  # NEW — sendCourseUpdateAvailableEmail (research.md §8)
│   │   ├── tenant-marketplace-routes.ts             # MODIFIED — +apply/dismiss routes
│   │   └── admin-marketplace-selection-routes.ts    # unchanged
│   ├── platform-courses/
│   │   ├── platform-course-routes.ts                # MODIFIED — remove IMMUTABLE_ONCE_CLONED_FIELDS gate; call recordPlatformCourseChange
│   │   ├── platform-course-content-routes.ts         # MODIFIED — remove rejectIfImmutable call sites; call recordPlatformCourseChange
│   │   └── platform-course-file-routes.ts            # MODIFIED — remove rejectIfImmutable call sites; preserveObjects param; call recordPlatformCourseChange
│   ├── courses/
│   │   └── tenant-course-routes.ts                   # MODIFIED — toResponseRows gains updateAvailable
│   ├── permissions/
│   │   └── require-permission.ts                     # MODIFIED — +listUsersWithPermission
│   ├── mail/
│   │   ├── send-mail.ts                              # NEW — sendMail extracted from tenant-auth/mailer.ts (research.md §8)
│   │   └── email-templates.ts                         # MODIFIED — +buildCourseUpdateAvailableEmail
│   └── tenant-auth/
│       └── mailer.ts                                  # MODIFIED — imports send-mail.ts instead of a private copy
└── (tests colocated per existing project convention)

apps/web/
├── lib/
│   ├── course-api-types.ts                            # MODIFIED — Course gains updateAvailable
│   └── course-editor-adapter.ts                        # MODIFIED — tenantCourseEditorApi gains applyMarketplaceUpdate/dismissMarketplaceUpdate
└── app/(dashboard-shell)/learning/courses/
    ├── courses-list-client.tsx                          # MODIFIED — update-available badge in row (next to existing status Badge)
    └── [courseId]/course-editor-client.tsx               # MODIFIED — update-available badge + apply/dismiss control in header
```

**Structure Decision**: No new top-level project or package — this is an in-place extension of the
existing `apps/api` (Fastify) + `apps/web` (Next.js) monorepo structure spec 029 already established for
the course marketplace. Every new file lives alongside its closest existing sibling (a new
`course-marketplace/` file next to `clone-platform-course.ts`, a new `mail/` file next to
`email-templates.ts`), consistent with how spec 029 itself organized platform-course code.

## Complexity Tracking

*No Constitution Check violations — table intentionally omitted.*
