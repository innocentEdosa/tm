# Research: Roles Management UI

All Technical Context items were resolvable by reading the actual existing code (`apps/api/src/
permissions/tenant-role-routes.ts`, `apps/api/src/db/schema/roles.ts`/`permissions.ts`, `apps/web/app/
(dashboard-shell)/layout.tsx`) and one direct database query — no item required speculation.

## 1. `manage_roles` is already correctly seeded — verified, not assumed

**What was checked**: The user flagged, when moving from `/speckit-clarify` to `/speckit-plan`, to
remember granting this permission to the `hr_admin` role template. Given Specs 009/010 both had to
ship a corrective migration because `department.manage`/`forms.manage.tenant` were missing from the
majority of already-live tenants' "HR/L&D Admin" roles (511 of 513 had a `NULL` `source_template_id`,
so the template-linked backfill in each spec's first migration silently missed them), the same class of
gap was worth directly checking for `manage_roles` before assuming it was fine.

**What's actually true**: It's already fine. `manage_roles` was seeded in migration `0005` and granted
to the `hr_admin` role template in `0006` — both from the very start of this project, before any tenant
had ever been provisioned. A direct query against the dev database confirms all 693 existing
"HR/L&D Admin" rows already have it:

```sql
SELECT count(*) AS total_hr_admin_roles,
       count(*) FILTER (WHERE rp.permission_id IS NOT NULL) AS has_manage_roles
FROM roles r
LEFT JOIN permissions p ON p.key = 'manage_roles'
LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission_id = p.id
WHERE r.name = 'HR/L&D Admin';
-- 693 | 693
```

**Rationale for the difference from Specs 009/010's gap**: `department.manage`/`forms.manage.tenant`
were seeded *after* those 511 legacy rows already existed (added in migrations `0025`/`0031`, long
after whatever earlier seed/import path created those rows), so a template-linked backfill run at
seeding time missed them. `manage_roles` was seeded *before* any of those rows existed, so whatever
non-`seedDefaultRolesForTenant` path created them already included it in its own original permission
list from the start.

**Decision**: No new seed/backfill migration is needed for this spec. This is recorded here explicitly
so the "remember to grant this permission" instruction is answered with verified evidence, not silently
dropped.

## 2. System-role protection needs to move from "doesn't exist" to "enforced server-side"

**What was checked**: `apps/api/src/db/schema/roles.ts` and `apps/api/src/permissions/
tenant-role-routes.ts` directly.

**What's actually true**: `roles.sourceTemplateId` already exists and is already populated correctly
(every tenant's `hr_admin`/`manager`/`employee` rows point back to their originating `role_templates`
row when created via `seedDefaultRolesForTenant`) — but it is purely provenance metadata today. Nothing
in the existing `PATCH`/`DELETE /tenant/roles/:roleId` handlers checks it before allowing a rename,
permission-set change, or deletion. A system role is, today, an entirely ordinary, mutable row.

**Decision**: Add an explicit `sourceTemplateId IS NOT NULL` check at the top of both the existing
`PATCH` and `DELETE` handlers (and the new endpoints don't need it, since they're read-only), returning
`403` with a clear message before any write is attempted. This is an application-layer guard, not an
RLS policy change — `roles` already has ordinary tenant_isolation RLS (spec 001), and *which* row within
a tenant's own set is protected is a business rule about that row's `sourceTemplateId` value, not a
tenant-boundary question RLS itself is meant to answer. Precedent: Department Management's own
hierarchy/depth/cycle checks (Spec 009) are likewise application-layer guards on top of ordinary RLS,
not expressed as RLS policies themselves.

**Alternatives considered**: Encoding the protection as a database-level `CHECK`/trigger was considered
and rejected — this codebase has no existing trigger precedent (Spec 009 research.md §3 already made
this same call for a different guard), and a plain application-layer check is simpler, easier to test,
and produces a much clearer client-facing error message than a raw constraint violation would.

## 3. `GET /tenant/roles` does not exist — confirmed, not assumed

**What was checked**: The full contents of `tenant-role-routes.ts` (three routes: `PATCH`, `POST`,
`DELETE`, no `GET` at all) and `specs/001-roles-permissions-model/contracts/
tenant-role-management-api.md` (documents only those same three).

**Decision**: Add `GET /tenant/roles`, gated by the same `requirePermission("manage_roles")` the
existing three routes already use, returning each role's `id`, `name`, `description`,
`permissionKeys`, `isSystem` (derived from `sourceTemplateId IS NOT NULL`), and `memberCount`. Member
count comes from a new shared query (`role-member-counts.ts`): `SELECT role_id, count(*) FROM
user_roles GROUP BY role_id`, scoped by the caller's own `request.tenantDb` (RLS already limits this
to the caller's own tenant's `user_roles` rows — no explicit tenant filter needed, consistent with
every other RLS-scoped query in this codebase).

**Alternatives considered**: Having the frontend call three separate existing/new endpoints (roles,
permission keys per role, member counts per role) and reassemble them client-side was rejected — it's
slower (multiple round-trips), and pushes data-shaping work onto the frontend that belongs on the
server, inconsistent with every other list screen in this codebase (Department, Forms) which each
return one fully-shaped list from a single endpoint.

## 4. Tenant-facing permission catalog read does not exist — confirmed, not assumed

**What was checked**: The only existing catalog read, `GET /admin/permissions`
(`apps/api/src/permissions/admin-routes.ts`), is gated by `requireSuperAdminSession` — a platform-wide,
non-tenant-scoped route that queries via `fastify.db` (the pool-bound instance), not
`request.tenantDb`. There is no tenant-facing equivalent.

**Decision**: Add `GET /tenant/permission-catalog`, gated by `requirePermission("manage_roles")`,
returning the same shape (`id`, `key`, `displayName`, `description`, `category`) but through
`request.tenantDb` for consistency with every other tenant-scoped route in this codebase — even though
`permissions` itself has no `tenant_id` column and RLS doesn't actually scope it, using the tenant
connection keeps this route consistent with its sibling routes in the same file rather than introducing
`fastify.db` into a file that otherwise only ever uses `request.tenantDb`. Grouping by `category` is
done client-side (a simple `groupBy` over the flat list), matching how `GET /admin/permissions` is
already flat and left ungrouped server-side — no new precedent needed.

**Alternatives considered**: Reusing `GET /admin/permissions` directly from the tenant-facing frontend
was rejected outright — it requires a Super Admin session, which a tenant user can never have; the two
are on entirely separate authentication systems by design (Super Admin Authentication spec).

## 5. Testing: Vitest integration tests against real Postgres, mirroring every prior spec's convention

**Decision**: New behavior (list shape/member counts, permission catalog grouping, system-role
rejection on direct PATCH/DELETE calls, impact-warning-relevant member counts, blocked-delete-with-
members) is covered by new files under `apps/api/tests/integration/`, run via the existing `vitest run`
script against a real Postgres connection — identical reasoning to every prior spec in this codebase:
permission-gating and RLS-adjacent behavior can't be proven "actually enforced" with a mocked database.

**Alternatives considered**: None — direct continuation of an established, working convention.

## 6. Real data-quality gap found during implementation: `source_template_id` was missing on the vast majority of already-live "HR/L&D Admin"/"Manager" roles

**What was found**: Live browser verification (not just automated tests) showed a real tenant's
"HR/L&D Admin" role rendering as **Custom** instead of **System** — the exact same class of gap
already documented for permission grants (0025/0026, 0031), except this time affecting
`source_template_id` itself, the very column this spec's `isSystem` flag and system-role guard
depend on. A direct query confirmed the scope: 707 of 711 "HR/L&D Admin" rows and 65 of 776
"Manager" rows had a `NULL` `source_template_id` (`Employee/Learner` had none missing).

**Decision**: Migration `0037_backfill_role_source_template_id_by_name.sql` backfills
`source_template_id` by exact role-name match against `role_templates.name` — the same reasoning
0026 already established (a tenant can't have two roles sharing one name, so an exact match is a
safe, high-confidence signal). Deliberately excludes 111 rows literally named "Employee" (not
"Employee/Learner") — that name doesn't exactly match any current template, so backfilling it would
be a separate, lower-confidence call outside this migration's conservative scope.

**A second, more serious discovery**: applying that migration didn't stay fixed — a *pre-existing*
test, `provision-tenant-missing-role-template.test.ts`, temporarily `DELETE`s the shared `hr_admin`
role_templates row to test a failure path. Because `roles.source_template_id` has
`ON DELETE SET NULL`, that single `DELETE` cascades and nulls out `source_template_id` on *every*
role across the entire shared dev database currently linked to it — not just that test's own
tenant — including real, already-provisioned tenants' data. The test's own cleanup re-inserted the
template row (with the same id) but never re-linked the roles it broke, so every test-suite run
silently undid this spec's fix. Fixed the test itself: it now captures which real role ids get
nulled *before* deleting the template, and explicitly re-links them in its own `finally` block,
rather than relying on the coincidence of reusing the same template id to (incorrectly) assume the
FK was restored. Verified by re-running the previously-destructive test and confirming the backfill
survives it.

**Rationale**: This was a pre-existing bug this session found and fixed as a necessary correctness
fix, not scope creep — leaving it in place would mean this spec's core System/Custom distinction
silently breaks itself every time the test suite runs against the shared dev database.

**Alternatives considered**: Re-running the backfill migration's `UPDATE` as a recurring/idempotent
step instead of fixing the test was rejected — it treats the symptom (data getting corrupted) rather
than the cause (a test with an incomplete cleanup), and would leave the same landmine for any other
future code path that touches `role_templates` rows.
