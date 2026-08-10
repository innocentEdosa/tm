# Research: Reusable Form Builder & Form Renderer

All items below were resolved during architecture research prior to this plan; no
`NEEDS CLARIFICATION` markers remain in the Technical Context.

## 1. Effective-form resolution: merge-at-read-time vs. clone-at-acquisition

**Decision**: Extend the existing merge-at-read-time model (`getFormFields()`,
`apps/api/src/custom-fields/field-key-uniqueness.ts`) — platform field/version data stays in one
place, read live and merged with tenant rows on every request. No cloning of platform structure
into tenant-owned rows.

**Rationale**: The codebase has two real precedents for "platform authors, tenant consumes":
- **Clone-at-acquisition** (`apps/api/src/course-marketplace/clone-platform-course.ts`,
  `clonePlatformCourseIntoTenant`): deep-copies platform course/module/content-item rows into
  tenant-owned tables (`sourcePlatformCourseModuleId` provenance column), because tenants need to
  freely edit curriculum content independently after acquisition — hence an explicit
  `applyPlatformCourseUpdateToTenant` reconciler and `marketplaceSelections.appliedPlatformCourseVersion`
  tracking to opt into updates.
- **Merge-at-read-time** (`getFormFields()`): `form_fields` rows with `tenant_id IS NULL`
  (global) and `tenant_id = caller` (tenant) live in the same table, read together on every call.

Forms need platform field *definitions* to stay centrally authoritative — a Super Admin editing a
platform field's label should be consistently reflected for every tenant that hasn't overridden
it, without each tenant needing to "apply an update." Course content doesn't have this property
(tenants are expected to diverge). Spec FR-021/FR-023 (tenant may only hide/reorder platform
fields, never edit their definition) is the direct expression of this choice.

**Alternatives considered**: Clone-per-tenant (rejected — would require an update-reconciliation
mechanism per tenant per publish, and contradicts FR-023's "platform field definition is never
copied into tenant-owned storage").

## 2. No new npm dependency required

**Decision**: Build the visual builder's drag-and-drop canvas with `@dnd-kit/core` +
`@dnd-kit/sortable` + `@dnd-kit/utilities` (already declared in `apps/web/package.json`, already
used in production in `apps/web/app/(dashboard-shell)/learning/courses/[courseId]/curriculum-tab.tsx`
for the reorderable Course Outline). Build every dialog/list/form-chrome primitive from `@tm/ui`
(`Card`, `Drawer`, `Modal`, `Button`, `Input`, `Toggle`, `Badge`, `PageHeader`, `Popover`,
`RepeatableFieldList` as a pattern reference).

**Rationale**: No drag-and-drop library other than `@dnd-kit/*` exists anywhere in the repo's
`package.json` files; it's a better-supported precedent than the manual native-`draggable` code
in the current `forms-settings-client.tsx`. Per Constitution Principles XII–XIII, a dependency
already installed and already proven in production is the correct default — no new package, no
sign-off needed.

**Alternatives considered**: `react-beautiful-dnd`/`react-dnd`/`@hello-pangea/dnd` (rejected — not
installed anywhere, would be a net-new dependency with no justification over an already-adopted
option); continuing the manual HTML5 `draggable` pattern from `forms-settings-client.tsx`
(rejected — `@dnd-kit` is the more capable, already-production-proven pattern for the more complex
canvas this feature needs: nested step→section→field dragging, not just a flat list).

## 3. Monorepo package convention

**Decision**: New package at `packages/form-builder/`, name `@tm/form-builder`, structured
exactly like `packages/ui`: `"main"`/`"types"` point at `./src/index.ts` (no build step — Next.js
transpiles the TS source directly), `"exports": {".": "./src/index.ts"}`, `peerDependencies` on
`next`/`react`/`react-dom`, `devDependencies` on `@tm/tsconfig`, `dependencies` on `@tm/ui` and
`@dnd-kit/*`. Consumed via `"@tm/form-builder": "workspace:*"` in `apps/web/package.json`.

**Rationale**: `pnpm-workspace.yaml` includes `packages/*`; every existing internal package
(`@tm/ui`, `@tm/types`, `@tm/tsconfig`, `@tm/eslint-config`) uses the `@tm/` scope and this exact
no-build-step shape — matching it is the path of least surprise for the rest of the team.

**Alternatives considered**: A build step (tsup/tsc emitting `dist/`) — rejected, no existing
internal package in this repo does this; adding one for form-builder alone would be an
inconsistent, unjustified pattern deviation.

## 4. Drizzle schema wiring for new tables

**Decision**: Add `apps/api/src/db/schema/form-builder.ts` as a new flat file; extend
`apps/api/src/db/schema/custom-fields.ts` in place for the existing tables' new columns.

**Rationale**: `apps/api/drizzle.config.ts` points at `./src/db/schema/*` as a glob — there is no
barrel/index file aggregating schema files, and `apps/api/src/db/client.ts` calls `drizzle()`
with no schema argument (per-query typing via individual file imports). Dropping a new file into
that directory is the entire integration step; nothing else needs to be wired up. Next available
migration number confirmed as `0107` (last existing: `0106_course_marketplace_updates.sql`).

**Alternatives considered**: A single monolithic schema file for the whole feature — rejected,
inconsistent with the existing one-file-per-domain convention (`custom-fields.ts`,
`platform-courses.ts`, `training-needs.ts`, etc. are all separate files).

## 5. Super-Admin-writable, tenant-readable table pattern (unlocks runtime form-type creation)

**Decision**: `form_definitions` (existing, currently `SELECT`-only to `tm_app` per migration
`0029_lock_custom_fields_catalog_grants.sql`) gets `GRANT INSERT, UPDATE` (not `DELETE` —
archived, not deleted, matching the codebase's soft-delete convention) reopened to `tm_app`, plus
a `super_admin_full_access` RLS policy. The new `form_versions`/`form_steps`/`form_sections`
tables get `SELECT` granted to `tm_app` (tenant sessions read published structure) and the same
`super_admin_full_access` policy for writes.

**Rationale**: This is the exact, already-proven mechanism (6+ existing migrations, e.g.
`0067_super_admin_full_access_custom_field_values.sql`, `0059_super_admin_full_access_departments.sql`,
`0054_super_admin_full_access_tenants.sql`) for letting a verified Super Admin session write a
platform-level table through the *same* `tm_app` DB role every tenant session uses, gated purely
by:
```sql
CREATE POLICY "super_admin_full_access" ON "<table>"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
```
which only a session that has gone through `requireSuperAdminSession` (setting
`SET LOCAL app.is_super_admin = 'true'` in `apps/api/src/platform-auth/super-admin-context.ts`)
can ever satisfy. No ordinary tenant-scoped connection gains any new access — this is what makes
FR-001 ("create a form type with no migration") safe to build.

**Alternatives considered**: A separate privileged DB role/connection for Super Admin routes —
rejected, this codebase has never used one; every other Super-Admin-write case uses this same
RLS-policy technique on the existing `tm_app` role.

## 6. Terminology: "Super Admin" not "Platform Admin"

**Decision**: Use "Super Admin" exclusively throughout data model, API, and UI copy.

**Rationale**: `grep -i "Platform Admin\|PlatformAdmin\|platform_admin"` across `apps/` returns
zero matches. The codebase's only term for the cross-tenant administrator is "Super Admin"
(`super_admins`, `super_admin_sessions`, `requireSuperAdminSession`, `request.superAdmin`). The
feature request's "Platform Admin" is the same role this codebase already calls Super Admin.

## 7. Permissions: reuse `forms.manage.tenant`, gate Super Admin routes on session alone

**Decision**: Tenant-side Form Builder routes (add/edit tenant field, hide/unhide platform field,
reorder) reuse the existing `forms.manage.tenant` permission — no new permission key. Super
Admin platform-authoring routes (create form type, build/publish versions) are gated solely by
`requireSuperAdminSession`, with no `permissions` table row — consistent with how every other
Super-Admin-only surface in this codebase works (Super Admins have no `user_roles` rows, so
cross-tenant routes never consult the tenant `permissions` table at all).

**Rationale**: `apps/api/src/permissions/require-permission.ts` exports `requirePermission`/
`requireAnyPermission` (deny-by-default, checks `user_roles → role_permissions → permissions`);
`forms.manage.tenant` already exists (migration `0031_seed_forms_permissions.sql`) and is
semantically identical to what's needed here. `forms.manage.global` exists as a permission key
but is not consulted by any route today (a pre-existing, effectively vestigial key this feature
does not need to touch or resolve — Super Admin authorization already flows entirely through
`requireSuperAdminSession`).

**Alternatives considered**: A new `forms.builder.manage` permission — rejected per spec's own
Assumptions ("no new permission concept is introduced") and Constitution Quality Bar's implicit
preference for reuse over proliferation.

## 8. Testing conventions

**Decision**: Backend logic tested under `apps/api/tests/unit/form-builder/` (pure functions:
merge/reconciliation, hide-rule enforcement) and `apps/api/tests/integration/form-builder/`
(publish atomicity, tenant isolation, RLS-backed grant behavior), matching the existing
`apps/api/tests/{unit,integration}` split used by every other module. `packages/form-builder`
gets its own component/interaction tests co-located under its `src/` tree, matching how
`packages/ui` (where present) organizes tests next to source rather than in a separate top-level
`tests/` directory.

**Rationale**: Matches existing structure exactly — no new testing framework or convention
introduced.

## 9. Training Needs Analysis's existing workflow must survive migration untouched

**Decision**: TNA's own `draft → submitted → approved` status workflow
(`apps/api/src/training-needs/tenant-training-needs-routes.ts`, table `training_needs` with real
columns `departmentId`, `title`, `priority`, `status`, `approvedByUserId`/`approvedAt`) is
entirely out of scope for the Form Builder to model or replace — it stays exactly as-is,
untouched domain logic. The Form Builder migration for TNA (User Story 4) only replaces *how its
custom fields are rendered and resolved*, via `getEffectiveForm`/`<FormRenderer>`, exactly as it
already does today via `getFormFields()`/its own `renderField()` switch — it does not touch
`POST/PATCH/:id/approve` or the status state machine at all.

**Rationale**: Directly required by spec FR-031 (Form Builder never becomes the domain
persistence/workflow layer) and User Story 4's acceptance scenario 2 (draft/submitted/approved
workflow continues unchanged). TNA today has **no** multi-step wizard UI (confirmed: single flat
`space-y-4` field list) — migrating it does not require step support to already exist; step
support (User Story 2) is proven first on a synthetic/Department test case, not forced onto TNA.
