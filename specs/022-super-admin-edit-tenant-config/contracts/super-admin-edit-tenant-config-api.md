# Contract: Super Admin Edit Tenant Configuration API

Adds routes to the existing
`apps/api/src/super-admin-tenant-console/super-admin-tenant-console-routes.ts` plugin (Spec 020).
Every route requires `requireSuperAdminSession` and operates exclusively through
`request.superAdminDb!`, filtering every query explicitly by the route's own `:id` (tenant) param —
never relying on ambient RLS scoping (research.md §1). Per spec FR-012, every route below works
identically regardless of the target tenant's status (Active/Trial/Archived/Suspended/
Pending-Deletion) — no status check is performed.

## Member edit

### `PATCH /tenants/:id/members/:memberId`

**Purpose**: Edit an existing member's full name, role, department, custom field values, and
archived status (spec FR-003), reusing `PATCH /tenant/team/:userId`'s (Spec 013) exact mechanism.

**Body**:
```json
{
  "fullName": "string | omitted",
  "roleId": "uuid | omitted",
  "departmentId": "uuid | null | omitted",
  "customFieldValues": "object | omitted",
  "archived": "boolean | omitted"
}
```

**Behavior** (mirrors `PATCH /tenant/team/:userId` exactly, applied via `request.superAdminDb` with
explicit tenant filtering):
1. `404 { message: "Member not found" }` if `:memberId` does not resolve with `tenant_id = :id`.
2. `422 { message: "Role not found" }` if `roleId` is given and does not resolve with `tenant_id = :id`
   (tenant-scoped `roleExistsForTenant`, reused from Spec 021).
3. `422 { message: "Department not found or not active" }` if `departmentId` is given (non-null) and
   does not resolve to an active department with `tenant_id = :id` (tenant-scoped
   `departmentIsActiveForTenant`, reused from Spec 021).
4. If `archived === true`: `422 { message: "This member is a department Manager or Assistant
   Manager. Reassign that role before archiving them." }` if the member is currently a department's
   `manager_id` or `assistant_manager_id` (tenant-scoped `isDepartmentLeader` equivalent). No
   self-archive check (a Super Admin session has no comparable `users.id`).
5. If `customFieldValues` given: validate against the "member" form's tenant-scoped field set
   (tenant-scoped `getFormFields`/`validateCustomFieldValues`); `422` with per-field errors on
   failure, before any write.
6. Update `users` (`full_name`, `department_id`, `archived_at`), `user_roles` (`role_id`,
   single-row update), and `custom_field_values` (if given) — same order as the tenant-side route.
7. Insert one `member_action_log` row: `tenant_id: :id`, `member_id: :memberId`, `super_admin_id`,
   `action: "member_edited"`.
8. Respond `200` with the updated member row (same shape `GET /tenants/:id/members` already returns).

**Errors**: `404 { message: "Tenant not found" }` (`:id`), `404 { message: "Member not found" }`
(`:memberId`), `422` (role/department/custom-field validation), `403` (non-Super-Admin caller, via
`requireSuperAdminSession`).

## Roles

### `POST /tenants/:id/roles`

**Purpose**: Create a new role for tenant `:id` (spec FR-004), mirroring `POST /tenant/roles`
(Spec 011).

**Body**: `{ "name": "string", "description": "string | omitted", "permissionKeys": "string[] | omitted" }`

**Behavior**: `400` if `name` missing. Permission keys resolved only against the tenant-facing
catalog (`category != 'platform'`, research.md §4) — an unrecognized or `platform`-category key is
silently dropped, same as the tenant-side route's own `inArray(permissions.key, permissionKeys)`
behavior. `409 { message: "Role name already exists" }` on a `(tenant_id, name)` conflict. Inserts
`roles` (`tenant_id: :id`) then `role_permissions`. Logs `tenant_config_action_log`
(`entity_type: "role"`, `action: "role_created"`). Responds `201`.

### `PATCH /tenants/:id/roles/:roleId`

**Purpose**: Edit an existing custom role's name, description, and permission assignments (spec
FR-004).

**Body**: `{ "name": "string | omitted", "description": "string | omitted", "permissionKeys": "string[] | omitted" }`

**Behavior**: `404` if `:roleId` does not resolve with `tenant_id = :id`. `403 { message: "System
roles cannot be modified." }` if `source_template_id IS NOT NULL` — checked before any write, even
though the target already resolved. Same update/delete-then-reinsert shape as
`PATCH /tenant/roles/:roleId`. Logs `tenant_config_action_log` (`action: "role_edited"`). Responds
`200`.

### `DELETE /tenants/:id/roles/:roleId`

**Purpose**: Delete a custom role with no members assigned (spec FR-004/FR-005).

**Behavior**: `404` if not found scoped to `:id`. `403` same system-role message as PATCH, checked
before the member-assignment check (research.md's own `tenant-role-routes.ts` comment: so a system
role with zero members still correctly reports "cannot be modified," not a silent success). `409
{ message: "Role has users assigned; reassign them before deleting." }` on a `23503` FK violation.
Logs `tenant_config_action_log` (`action: "role_deleted"`) only on success. Responds `204`.

**Non-goal**: The single platform-wide Super Admin role (`tenant_id IS NULL`) is never reachable
through any of the three routes above — every lookup filters by `tenant_id = :id`, and `:id` always
resolves to a real tenant row (spec FR-006).

## Departments

### `POST /tenants/:id/departments`

**Purpose**: Create a new department for tenant `:id` (spec FR-007), mirroring
`POST /tenant/departments` (Spec 009).

**Body**: `{ "name": "string", "parentDepartmentId": "uuid | null | omitted", "description": "string | omitted", "managerId": "uuid | null | omitted", "assistantManagerId": "uuid | null | omitted" }`

**Behavior**: `400` if `name` missing. Hierarchy/manager validation via tenant-scoped equivalents of
`findAncestorChain` and the manager-existence check (research.md §1): `422` "Parent department not
found", `422` "Cannot set a department as its own parent or descendant", `422` "Departments can only
be nested up to 3 levels deep", `422` "Manager and Assistant Manager must be different people", `422`
"Manager/Assistant Manager user not found" (the looked-up user must also resolve with
`tenant_id = :id`). `409 { message: "A department with this name already exists" }` on a
case-insensitive `(tenant_id, name)` conflict. Logs `tenant_config_action_log`
(`entity_type: "department"`, `action: "department_created"`). Responds `201`.

### `PATCH /tenants/:id/departments/:departmentId`

**Purpose**: Edit an existing department's name, description, parent, status, and Manager/Assistant
Manager (spec FR-007).

**Body**: Same shape as POST, plus `"status": "active" | "archived" | omitted`.

**Behavior**: `404` if not found scoped to `:id`. Same hierarchy/manager/uniqueness validation as
POST, with the department being edited excluded from its own cycle check (`currentId`). Logs
`tenant_config_action_log` (`action: "department_edited"`). Responds `200`.

**Non-goal**: No `DELETE` route — department deletion is out of scope (spec FR-013); the tenant-side
mechanism itself has none to mirror.

## Custom field definitions

### `POST /tenants/:id/custom-fields`

**Purpose**: Create a new tenant-scoped custom field on one of tenant `:id`'s registered form types
(spec FR-008), mirroring `POST /tenant/form-fields` (Spec 010).

**Body**: `{ "formKey": "string", "label": "string", "fieldKey": "string | omitted", "fieldType": "text" | "textarea" | "number" | "date" | "select" | "multiselect", "options": "string[] | omitted", "isRequired": "boolean | omitted" }`

**Behavior**: `400` if `formKey`, `label`, or `fieldType` missing, or `fieldType` unrecognized, or
`options` missing for a `select`/`multiselect` field. `404 { message: "Unknown form type" }` if
`formKey` doesn't resolve. `fieldKey` defaults to `slugify(label)` if omitted. `409 { message: "A
field with this key already exists on this form" }` on a collision against a tenant-scoped equivalent
of `fieldKeyCollisionExists` (checked across both the global field set and this tenant's own — never
across a *different* tenant's fields). Inserts `form_fields` with `tenant_id: :id` (never `NULL`) and
`created_by: "super_admin"` (spec FR-009). Logs `tenant_config_action_log`
(`entity_type: "custom_field"`, `action: "custom_field_created"`). Responds `201`.

### `PATCH /tenants/:id/custom-fields/:fieldId`

**Purpose**: Edit or archive an existing tenant-owned field definition (spec FR-008).

**Body**: `{ "label": "string | omitted", "fieldType": "... | omitted", "options": "string[] | omitted", "isRequired": "boolean | omitted", "archived": "boolean | omitted" }`

**Behavior**: `404` if `:fieldId` does not resolve with `and(id = :fieldId, tenant_id = :id)` — this
condition is what makes a global (`tenant_id IS NULL`) field's id resolve as not-found here, same as
`PATCH /tenant/form-fields/:fieldId` today (spec FR-009, research.md §2 — enforced by this query, not
by RLS, since RLS alone would permit reaching it). `400` if `fieldType` given and unrecognized. Logs
`tenant_config_action_log` (`action: "custom_field_edited"` normally, or
`"custom_field_archived"` when the request sets `archived: true`). Responds `200`.

**Non-goals**: No reorder route (`form_field_order_overrides` stays untouched — spec FR-014); no
route can ever resolve or write a global field (`tenant_id IS NULL`) — those remain reachable only
through Spec 010's own not-yet-built global authoring screen.

## Cross-cutting non-goals (all routes above)

- No impersonation / "view as member" — every action is attributed to the Super Admin's own session
  (Spec 020 FR-015, unaffected).
- No bulk/CSV import, no resend/revoke-invite route (doesn't exist anywhere in this codebase today,
  per Spec 012 Non-goals), no tenant-status-changing side effect (Spec 015 territory).
- No route in this contract can create, edit, or expose the single platform-wide Super Admin role
  (`tenant_id IS NULL`) or a global custom field (`tenant_id IS NULL`).
