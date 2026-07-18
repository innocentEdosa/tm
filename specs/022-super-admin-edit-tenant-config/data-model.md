# Phase 1 Data Model: Super Admin Edit Tenant Configuration

This feature adds **one new table** (`tenant_config_action_log`) and **no new columns** anywhere. All
other writes go through tables and RLS policies that already exist.

## New table: `tenant_config_action_log`

Append-only, platform-level, no RLS — same posture as `member_action_log` (research.md §3).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `tenant_id` | `uuid`, nullable, FK → `tenants.id` ON DELETE SET NULL | Nullable so the log survives a later tenant deletion, mirroring `member_action_log.tenant_id`. |
| `super_admin_id` | `uuid`, nullable, FK → `super_admins.id` ON DELETE SET NULL | Same nullable-survives-deletion treatment. |
| `entity_type` | `text` NOT NULL | `"role" \| "department" \| "custom_field"` — a check constraint, same style as `form_fields.form_fields_created_by_check`. |
| `entity_id` | `uuid` NOT NULL | No FK — polymorphic across `roles`/`departments`/`form_fields`, same reasoning `custom_field_values.entity_id` already uses. |
| `action` | `text` NOT NULL | e.g. `"role_created"`, `"role_edited"`, `"role_deleted"`, `"department_created"`, `"department_edited"`, `"custom_field_created"`, `"custom_field_edited"`, `"custom_field_archived"`. Free text, not an enum — same as `member_action_log.action`. |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

`tm_app` grant: `SELECT, INSERT` only (migration `0066`) — no `UPDATE`/`DELETE`, append-only.

## Modified (data only — no schema change): `users`, `user_roles`

| Table | Existing policy exercised | What this feature writes |
|---|---|---|
| `users` | `super_admin_full_access` (migration 0063 — `WITH CHECK` already permits `UPDATE`) | `full_name`, `department_id`, `archived_at` (member edit surface, FR-003), plus custom field values written to `custom_field_values` (below). |
| `user_roles` | `super_admin_full_access` (migration 0062 — permits `UPDATE`) | `role_id`, single-row update, same "exactly one role per user" invariant Spec 013's own `PATCH /tenant/team/:userId` preserves. |

`archived` MUST be blocked (422, no write) if the target member is currently a department's
`manager_id` or `assistant_manager_id` (`isDepartmentLeader`-equivalent, tenant-scoped) — mirrors
Spec 013 exactly. Unlike the tenant-side route, there is no "cannot archive your own account" check
here — a Super Admin session has no `users.id` row to compare against.

## Modified (data only): `roles`, `role_permissions`

| Table | Existing policy exercised | What this feature writes |
|---|---|---|
| `roles` | `super_admin_full_access` (migration 0060 — permits INSERT/UPDATE/DELETE) | Create: `tenant_id`, `name`, `description`. Edit: `name`, `description`. Delete: removes the row. |
| `role_permissions` | `super_admin_full_access` (migration 0061 — permits INSERT/DELETE) | Full delete-then-reinsert of a role's permission set on edit, same as `PATCH /tenant/roles/:roleId`. |

A role with `source_template_id IS NOT NULL` (system role) MUST be rejected for edit/delete with the
same `"System roles cannot be modified."` message, before any write — no Super Admin bypass (spec
FR-005). A role with ≥1 `user_roles` row MUST be rejected for delete with the same `409` "reassign
members first" conflict the tenant-side `23503` FK-violation handler already produces.

## Modified (data only): `departments`

| Table | Existing policy exercised | What this feature writes |
|---|---|---|
| `departments` | `super_admin_full_access` (migration 0059 — permits INSERT/UPDATE) | Create: `tenant_id`, `name`, `parent_department_id`, `description`, `manager_id`, `assistant_manager_id`, `status: "active"`. Edit: same fields, plus `status`. |

Hierarchy (3-level cap, no cycles) and Manager/Assistant-Manager-must-differ-and-must-exist checks
run before any write, via tenant-scoped equivalents of `findAncestorChain` and the manager-lookup in
`validateHierarchyAndManagers` (research.md §1) — never the ambient-RLS-scoped originals. Department
deletion is out of scope (spec FR-013) — the tenant-side mechanism itself has no `DELETE` route to
mirror, only create/edit/status-change.

## Modified (data only): `form_fields`

| Table | Existing policy exercised | What this feature writes |
|---|---|---|
| `form_fields` | `super_admin_full_access` (migration **0028**, already shipped — research.md §2, not a new migration) | Create: `form_definition_id`, `tenant_id` (never `NULL`), `field_key`, `label`, `field_type`, `options`, `is_required`, `display_order`, `created_by: "super_admin"`. Edit/archive: `label`, `field_type`, `options`, `is_required`, `archived_at`. |

Every query MUST filter explicitly by `tenant_id = :id` (research.md §2) — RLS alone permits reaching
a global (`tenant_id IS NULL`) row, so the route logic itself is what keeps this feature scoped to one
tenant's own fields, never a global one (spec FR-009). Field-key uniqueness (per form type, across
global + this tenant's own fields) is checked via a tenant-scoped equivalent of
`fieldKeyCollisionExists`.

## Modified (data only): `custom_field_values`

| Table | Existing policy exercised | What this feature writes |
|---|---|---|
| `custom_field_values` | `tenant_isolation`-equivalent already covered by `super_admin_full_access`-style access via `form_fields`' own posture — this table's RLS is unaffected; writes route through the same `writeCustomFieldValues` upsert-by-`(tenant_id, entity_id, field_id)` shape | Member-edit surface only (FR-003): one row per submitted custom field value on the "member" form, `entity_id = the edited member's id`. |

## New recorded values (no schema change): `member_action_log.action`

| Value | Written when |
|---|---|
| `"member_edited"` | The member-edit surface (FR-003) completes successfully. |

## Read-only inputs (validated against, not modified)

- **Role** (member-edit, role-edit): must exist with `tenant_id = :id`.
- **Department** (member-edit, department-edit): must exist (and, for member archival, must resolve
  active where required) with `tenant_id = :id`.
- **Permission catalog**: `permissions` table, filtered `category != 'platform'` (research.md §4) —
  read-only, same rows the tenant-side route already exposes.
- **Form definition**: `form_definitions`, looked up by `formKey` — platform-global, read-only,
  unchanged from Spec 010.

## Request/response shapes (not new entities — see contracts/)

- **Edit Member input**: `{ fullName?: string; roleId?: string; departmentId?: string | null; customFieldValues?: Record<string, unknown>; archived?: boolean }`.
- **Create/Edit Role input**: `{ name: string; description?: string; permissionKeys?: string[] }` (create) / all fields optional (edit).
- **Create/Edit Department input**: `{ name?: string; parentDepartmentId?: string | null; description?: string; status?: "active" | "archived"; managerId?: string | null; assistantManagerId?: string | null }`.
- **Create/Edit Custom Field input**: `{ formKey?: string; label?: string; fieldKey?: string; fieldType?: "text" | "textarea" | "number" | "date" | "select" | "multiselect"; options?: string[]; isRequired?: boolean; archived?: boolean }`.
