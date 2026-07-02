# Research: Tenant Provisioning Core

All decisions below build directly on the shipped implementation of Spec 1 (Roles & Permissions
Model) — `apps/api/src/{db,plugins,permissions}/`, inspected directly rather than only its plan, since
code and plan can drift. No new runtime infrastructure (roles, DB pooling, auth stub) is introduced;
this feature extends the existing schema and reuses the existing `tenant-context` idiom.

## 1. How does provisioning create rows scoped to a `tenant_id` that doesn't exist yet?

**Decision**: Generate `tenantId` (`crypto.randomUUID()`) in application code *before* opening the
provisioning transaction. Immediately after `BEGIN`, run
`SELECT set_config('app.tenant_id', $1, true)` with that generated id — exactly the idiom
`apps/api/src/plugins/tenant-context.ts` already uses per-request, just invoked directly by a
standalone service function instead of a request hook. Every subsequent insert in the same
transaction (`tenants`, `departments`, `users`, `roles` via `seedDefaultRolesForTenant`,
`user_roles`) is then RLS-scoped to that id from its very first write, satisfying spec FR-003 and
FR-005 without any special-cased "pre-tenant" code path.

**Rationale**: This is the same bootstrapping trick already implicit in `0007_seed_super_admin_role.sql`
(a write to a tenant-scoped-shaped table before that "tenant" conceptually exists) and requires zero
new Postgres roles or RLS carve-outs — `tenants` can use the exact same
`USING/WITH CHECK (id = current_setting('app.tenant_id', true)::uuid)` policy as every other
tenant-scoped table (see data-model.md).

**Alternatives considered**:
- A dedicated `tm_provisioning` Postgres role with `BYPASSRLS` (mirroring `tm_platform_reader`) —
  rejected. It would work, but it silently removes the `WITH CHECK` safety net that
  `seedDefaultRolesForTenant`'s own contract (spec 1's `contracts/seed-default-roles-interface.md`)
  explicitly relies on ("relies on RLS `WITH CHECK` policies... to scope its own inserts"). Reusing
  `tm_app` with the id-generated-first trick keeps that guarantee intact for this new caller too, at
  no extra infrastructure cost (Constitution Principle XII).

## 2. How is subdomain uniqueness enforced without a cross-tenant read?

**Decision**: `tenants.subdomain` gets a plain Postgres `UNIQUE NOT NULL` constraint. The provisioning
transaction just attempts the `INSERT`; on a unique-violation (`23505`) it rolls back and returns a
409-style "subdomain already taken" response — the exact `pgErrorCode(err) === "23505"` idiom already
used in `apps/api/src/permissions/tenant-role-routes.ts` for duplicate role names.

**Rationale**: A separate "does this subdomain already exist" pre-check would require reading across
*all* tenants before the new tenant's `app.tenant_id` is set — which the RLS policy from research.md
§1 would reject outright (no rows are visible until `app.tenant_id` matches a row's `id`, and it can't
match anything yet). Postgres unique-constraint enforcement is not filtered by RLS (a well-documented
Postgres behavior: a conflicting row is still detected even if the inserting session couldn't `SELECT`
it), so this sidesteps the whole problem — no elevated role, no pre-read, one INSERT.

**Alternatives considered**:
- Pre-check `SELECT` through a `BYPASSRLS` platform role, then INSERT — rejected as an unnecessary
  extra round trip and an unnecessary new role for something the unique constraint already guarantees
  atomically (avoids a race between the check and the insert, too).

## 3. Is provisioning one HTTP request or a multi-step wizard API?

**Decision**: One endpoint, `POST /provisioning/tenants`, accepting the full payload (company
details, optional final department list, admin details) and performing every write inside a single
Postgres transaction, committed only if every step succeeds.

**Rationale**: This is the most direct way to deliver spec FR-013 (all-or-nothing provisioning) without
building a saga/compensation system. The spec's own Assumptions section flagged the *mechanism* for
atomicity as a planning-level decision — a single transaction behind a single request is the simplest
mechanism that satisfies "no partially-created tenant is ever left visible or usable," and matches how
`apps/api/src/plugins/tenant-context.ts` already commits/rolls back one transaction per request. A
frontend wizard can still collect company details → department customization → admin details across
multiple *screens* without multiple *requests*; it submits once, at the end.

**Alternatives considered**:
- Multiple endpoints (create tenant → add departments → create admin → assign role), each its own
  transaction — rejected. Guaranteeing atomicity across separate HTTP requests needs a saga/rollback
  system this spec's scope doesn't call for, and the "sales-assisted, single sitting" usage pattern
  (Clarifications; SC-001) doesn't need incremental persistence between steps.

## 4. How does the initial admin get the HR Admin role?

**Decision**: Reuse `seedDefaultRolesForTenant` (`apps/api/src/permissions/seed-default-roles.ts`)
unchanged — it already creates one `roles` row per non-platform `role_templates` row (including
`hr_admin`) scoped to the new tenant. The provisioning function then looks up the tenant's newly
created role where `source_template_id` matches the `role_templates` row whose `key = 'hr_admin'`, and
inserts the single `user_roles` row linking the new admin to it.

**Rationale**: This is exactly the contract Spec 1 published for this purpose
(`contracts/seed-default-roles-interface.md`: "Exposed for the future tenant-provisioning spec to
call"). It also means every tenant starts with all four default roles available (not just HR Admin)
for whoever manages the tenant later, matching spec 1 FR-005's intent, while only the admin user gets
assigned one of them here (FR-011).

**FR-014 (fail if the template is missing)**: before calling `seedDefaultRolesForTenant`, the
provisioning function checks that a `role_templates` row with `key = 'hr_admin'` exists; if not, it
throws before any insert happens, so the transaction rolls back cleanly.

## 5. Where does `department_templates`/`departments` fit relative to `role_templates`/`roles`?

**Decision**: Mirror the existing `role_templates` → `roles` shape, minus the permissions join table
(departments don't carry permissions): `department_templates` (platform-global, `key`/`name`, seeded
by migration) and `departments` (tenant-scoped, RLS-enabled, `source_template_id` FK back to the
template it came from, nullable for admin-created departments). A new `seedDefaultDepartmentsForTenant`
function mirrors `seedDefaultRolesForTenant`'s shape for symmetry and testability
(contracts/seed-default-departments-interface.md).

**Rationale**: Same tenant-isolation reasoning as `roles`/`role_templates` in spec 1's data model — the
set of default departments is a platform-level catalog decision (only a migration changes it), while
each tenant's actual department rows are fully tenant-owned and freely editable (spec FR-006, FR-007).

**Default department templates seeded** (reasonable defaults for a general company org chart, not
industry-specific — see spec.md Assumptions on flat, non-hierarchical structure for this milestone):
`hr` (Human Resources), `sales` (Sales), `engineering` (Engineering), `finance` (Finance), `operations`
(Operations), `customer_support` (Customer Support).

**Customization contract**: the `POST /provisioning/tenants` request body's `departments` field is
optional. Omitted → the provisioning function seeds exactly the default templates. Provided (an array
of `{ name }`) → the provisioning function creates exactly that list instead, letting the caller
represent whatever renaming/adding/removing already happened client-side during the wizard, submitted
once at the end (see §3).

## 6. Where does the `users` table come from, and how does it relate to Spec 3 (auth)?

**Decision**: This spec creates `users` (minimal: `id`, `tenant_id`, `full_name`, `email`,
`created_at`, `updated_at` — no password/SSO columns). Spec 1's `user_roles.user_id` column already
existed as a bare `uuid` with no FK (its data-model.md explicitly deferred the owning table to "a
future...spec"). A FK from `user_roles.user_id` to this table was attempted and then reverted during
implementation: `users.tenant_id` is `NOT NULL`, but Spec 1's platform Super Admin role assignment
(`roles.tenant_id IS NULL`) has no tenant to attach a `users` row to — no spec has yet defined how a
platform operator is represented as a row here, so the FK would have blocked Super Admin role
assignment entirely. `user_roles.user_id` stays a bare `uuid`, unchanged from Spec 1 (data-model.md
`user_roles`). Spec 3 (auth method selection) is expected to *extend* this same `users` table with
auth-specific columns (password hash, SSO provider linkage), not create a competing table.

**Rationale**: Spec FR-008/FR-009 require creating a real admin account during provisioning — that
requires a `users` table to exist now, not later. Keeping it auth-free matches the explicit spec
scope boundary ("authentication method selection... is Spec 3") and constitution Principle XII (don't
build machinery — password hashing, SSO linkage — this spec has no requirement for yet).

## 7. Provisioning-endpoint access control

**Decision**: New permission `provision_tenant` (category `platform`), granted only to the platform
Super Admin role (both `role_template_permissions` for `super_admin`, for future reseeds, and directly
to the existing live `roles` row where `tenant_id IS NULL`, since that row was already seeded by Spec
1's `0007_seed_super_admin_role.sql` before this permission existed — mirrors how `0006`/`0007`
seeded together). Guarded by `requirePlatformPermission("provision_tenant")`
(`apps/api/src/permissions/require-platform-permission.ts`), unchanged, the same guard already used by
the Super Admin catalog routes.

**Rationale**: Per Clarifications, provisioning is sales-assisted for this milestone — an internal
team member runs it, not the prospect. No dedicated "Sales/Ops" platform role exists yet (spec 1 ships
exactly one platform role, Super Admin), so internal staff performing provisioning are assumed to hold
Super Admin for now. A narrower platform role is a reasonable future refinement, out of scope here
(see spec.md Assumptions).

## 8. New dependencies

**Decision**: None. Everything this feature needs — Fastify routing, Drizzle ORM/Kit, the existing
`pg` pool, Vitest — is already installed and used identically to Spec 1's implementation.
`apps/web`'s new provisioning-wizard screen reuses the same Tailwind/`@tm/ui`/`@tm/types` conventions
already used by `apps/web/app/admin/permissions/page.tsx`; no new frontend library is introduced.

## 9. Design system

**Decision**: No design system is locked yet (constitution Principle V, unchanged since Spec 1). The
provisioning wizard screens follow the exact same "minimal, nascent conventions (Tailwind v4, `@tm/ui`
palette/tokens) pending a fully locked design system" note already present verbatim in
`apps/web/app/admin/permissions/page.tsx` — flagged again here rather than introducing a second,
divergent ad hoc style.
