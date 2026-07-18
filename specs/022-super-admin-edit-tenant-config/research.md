# Phase 0 Research: Super Admin Edit Tenant Configuration

## §1. Tenant-scoped equivalents needed for every write helper, not just role/department existence

**Decision**: For all four surfaces, do not call the existing tenant-side helper functions unmodified
against `request.superAdminDb`. Write small, local, explicitly `tenant_id`-filtered equivalents,
following the exact pattern Spec 021 already established (`roleExistsForTenant`,
`departmentIsActiveForTenant` in `add-tenant-member.ts`) and Spec 020's own `get-tenant-departments.ts`
already follows for reads ("Deliberately does NOT reuse `department-hierarchy.ts`'s helpers... those
rely on `request.tenantDb`'s ambient RLS scoping").

**Rationale**: Every tenant-side write helper this feature mirrors assumes `request.tenantDb`'s
ambient RLS scoping and takes no `tenant_id` parameter:

| Helper | File | Assumes ambient scoping via |
|---|---|---|
| `roleExists`, `departmentIsActive`, `isDepartmentLeader` | `tenant-auth/team-write-validation.ts` | `request.tenantDb` |
| `findAncestorChain`, `hasChildren`, `subtreeMemberCount` | `departments/department-hierarchy.ts` | `request.tenantDb` (own doc comment: "none needs its own `tenant_id` filter") |
| `getFormFields`, `fieldKeyCollisionExists` | `custom-fields/field-key-uniqueness.ts` | `request.tenantDb` (own doc comment: "a tenant session's RLS-scoped view of `form_fields` is already exactly...") |
| Manager/Assistant-Manager user lookup (`validateHierarchyAndManagers`) | `departments/tenant-department-routes.ts` | `request.tenantDb` |
| `getRoleMemberCounts` | `permissions/role-member-counts.ts` | Groups by `role_id` (already globally unique) — Spec 020's `get-tenant-roles.ts` already confirmed this one IS safely reusable unmodified, by intersecting its result against the target tenant's own role ids after the fact. |

`request.superAdminDb`'s `app.tenant_id` is pinned to a nil UUID; none of the above narrows to one
tenant on its own. Calling any of them unmodified would let this feature validate a role, department,
manager, or field key against *any* tenant's data, not just the target tenant's — the exact class of
leak Spec 020 research.md §1 first identified.

**Alternatives considered**: Adding an optional `tenantId` parameter to each existing helper and
threading it through both call sites (tenant-side and this feature's). Rejected for the same reason
Spec 021 rejected it: touches four files owned by four different prior specs, for the benefit of one
new caller each — small, local, explicitly-filtered duplicates are simpler to review in isolation and
carry zero risk of changing behavior for any existing tenant-side route.

## §2. Correction: `form_fields` already has Super Admin RLS access — no new migration needed there

**Decision**: No new RLS or grant migration for `form_fields`. This corrects both this spec's own
Input text and its first-draft FR-009/Assumptions, which assumed (from grepping migration *filenames*
for `form_fields`, which returned nothing) that no `super_admin_full_access` policy existed yet.

**Rationale**: Reading `0028_rls_custom_fields.sql`'s actual contents (not just its filename) shows a
third, already-shipped policy on `form_fields`:

```sql
CREATE POLICY "super_admin_full_access" ON "form_fields"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
```

— added specifically ahead of need, for Spec 010 FR-002's "not-yet-built" global authoring screen
(the migration's own comment says so explicitly). `0029_lock_custom_fields_catalog_grants.sql` also
already grants `tm_app` full `SELECT, INSERT, UPDATE, DELETE` on `form_fields`. A Super Admin session
therefore already has full read/write access to every `form_fields` row, global or tenant-owned alike
— this feature is simply the first caller to actually exercise that access for real, and the first to
do so for a *tenant-scoped* row rather than the still-unbuilt global-authoring case FR-002 anticipated.

**Consequence for this plan**: Because RLS grants access to *every* row (global and tenant-owned),
this feature's own route handlers — not RLS — must be the thing that stops a Super Admin from editing
or archiving a global field (`tenant_id IS NULL`) through this tenant-scoped mechanism (spec FR-009).
Every query in the new handlers filters explicitly by `and(eq(formFields.id, fieldId),
eq(formFields.tenantId, targetTenantId))` — a global row's `tenantId` is `NULL`, which never equals a
real tenant id, so it naturally resolves as not-found, the same shape `PATCH /tenant/form-fields/:fieldId`
already uses today (just with the tenant id sourced from the route's own `:id` param instead of
`request.user!.tenantId`).

## §3. New `tenant_config_action_log` table (per spec Clarifications)

**Decision**: Add one new table, `tenant_config_action_log` (`id`, `tenant_id`, `super_admin_id`,
`entity_type`, `entity_id`, `action`, `created_at`), append-only, no RLS — same platform-level posture
as `member_action_log`. Two new migrations, mirroring the exact split already used for
`member_action_log` (`0057_member_action_log_table.sql` / `0058_lock_member_action_log_grants.sql`):

- `0065_tenant_config_action_log_table.sql` — `CREATE TABLE` + FKs (`tenant_id` → `tenants.id` ON
  DELETE SET NULL, `super_admin_id` → `super_admins.id` ON DELETE SET NULL — no FK on `entity_id`,
  polymorphic across `roles`/`departments`/`form_fields` by design, same reasoning
  `custom_field_values.entity_id` already uses).
- `0066_lock_tenant_config_action_log_grants.sql` — `GRANT SELECT, INSERT ON tenant_config_action_log
  TO tm_app;` (no UPDATE/DELETE — append-only, identical to 0058).

**Rationale**: `member_action_log`'s own schema comment already explains why it wasn't merged into
`tenant_action_log`: "kept as a separate table rather than adding a nullable member column to that
one, since `tenant_action_log` records actions *about a tenant*, not actions *about one of a tenant's
members*." The same reasoning argues against overloading `member_action_log` with role/department/
field ids now — those aren't member actions either. `entity_type` (`"role" | "department" |
"custom_field"`) plus `entity_id` gives one flat, generically queryable log for all three, without a
column that's `NULL` for member actions and populated for everything else.

**Alternatives considered**: (a) Reuse `member_action_log` with `memberId` left `NULL` — rejected,
loses per-record traceability for SC-005. (b) Extend `member_action_log` with a nullable
`entityType`/`entityId` pair — rejected, conflates two different audit shapes in one table, against
the codebase's own established convention (separate log/table per distinct entity shape).

## §4. Role-edit permission catalog reuses the tenant-side filter (per spec Clarifications)

**Decision**: The Super Admin role-edit surface's permission picker draws from the exact same query
`GET /tenant/permission-catalog` already uses — `where(ne(permissions.category, "platform"))` — a
new, tenant-filtered equivalent in the console module, not the full unfiltered `permissions` table.

**Rationale**: `platform`-category keys (`view_permission_catalog`, `provision_tenant`) are only ever
checked by `requireSuperAdminSession` routes, never by `requirePermission()` against a tenant role
(`tenant-role-routes.ts`'s own comment). Assigning one to a tenant role would be a meaningless,
confusing no-op checkbox — excluding it here keeps this feature's own "mirror the exact existing
mechanism" principle intact rather than opening a new, unreviewed capability.

## §5. Frontend: extend the existing console page and tabs, add one new "Forms" tab

**Decision**: All four surfaces' UI lives in the existing single-file Client Component
`apps/web/app/(platform-shell)/tenants/[tenantId]/page.tsx` (Specs 020/021), not a new page:

- **Members tab**: add an "Edit" button per row (alongside the existing "Reset Password" button),
  opening a Modal pre-filled from that row's data — same `Modal`/`Input`/`select` pattern as the
  existing Add Member modal (Spec 021), plus a fetch of that member's current custom field values
  (`GET /tenant/custom-field-values`-equivalent) and the "member" form's field definitions to render
  alongside.
- **Departments tab**: the existing read-only table gains an "Edit" button per row and a "New
  Department" button, both opening a Modal built from the tenant-side department form's fields (name,
  description, parent, status, Manager, Assistant Manager) — this table already fetches everything
  needed to populate an edit form (`GET /tenants/:id/departments` already returns
  `parentDepartmentId`/`manager`/`assistantManager`/`status`), so no new GET route is needed for
  prefill.
- **Roles tab**: the existing read-only table gains an "Edit" button per non-system role, a "New
  Role" button, and a "Delete" action — Modal with name/description fields plus a permission-key
  checkbox list, grouped the same way the tenant-side Roles & Permissions screen groups them. System
  roles (`isSystem: true`, already returned by `GET /tenants/:id/roles`) render without an Edit/Delete
  action, mirroring `settings/roles/page.tsx`'s own system-role treatment.
- **Forms tab (new)**: this console has no Forms/custom-fields tab today — add one, modeled on
  `apps/web/app/(dashboard-shell)/settings/forms/forms-settings-client.tsx`'s field list + add/edit
  form, but using this console's established Modal pattern (not that page's `Drawer`), consistent
  with Spec 020 research.md §7's own "Modal for a short form" rule. Reordering
  (`form_field_order_overrides`, that page's drag-and-drop) is explicitly out of scope (spec FR-014)
  — this tab is add/edit/archive only, no drag handles.

**Rationale**: Every one of these four surfaces already has a proven UI reference to mirror
(tenant-side Team Directory edit, Department Management, Roles & Permissions, Forms settings) and an
established container to extend (this console page's existing tab/Modal shape) — no new page, no new
top-level navigation, no new component library pattern.

**Alternatives considered**: A dedicated full-page editor per surface (matching the tenant-side
pages' own page-level layout instead of a Modal). Rejected — none of these edits has enough fields to
outgrow a Modal (the largest, department edit, has 6 fields, same order of magnitude as the existing
Add Member modal), and a full-page editor would be a new navigation pattern this console has
deliberately avoided so far (Spec 020 research.md §7).
