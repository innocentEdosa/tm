# Phase 1 Data Model: Training Request Rename

No table, column, index, or constraint is added, removed, or altered by this feature. The only data
change is to five existing rows' `key` column value in the platform-shared `permissions` table
(`apps/api/src/db/schema/permissions.ts`) — everything below documents that value change and
confirms which entities are and are not affected.

## Permission (existing entity — `permissions` table)

| Field | Type | Change |
|---|---|---|
| `id` | `uuid` (PK) | Unchanged — this is what every `role_permissions`/`role_template_permissions` row actually references. |
| `key` | `text` (unique) | **Changed for 5 rows** — see mapping table below. This is the only column this feature writes. |
| `display_name` | `text` | Updated for the same 5 rows, e.g. "View All Training Needs" → "View All Training Requests" (cosmetic only, shown in the Roles Management UI, spec 011). |
| `description` | `text` | Updated for the same 5 rows to replace "training-need entry/entries" wording with "training-request". |
| `category` | `text` | Unchanged (`learning`). |

### Key mapping (old → new)

| Old `key` | New `key` |
|---|---|
| `tna.view.all` | `training_request.view.all` |
| `tna.view.department` | `training_request.view.department` |
| `tna.manage.all` | `training_request.manage.all` |
| `tna.manage.department` | `training_request.manage.department` |
| `tna.approve` | `training_request.approve` |

Each row's `id` (the value every relationship actually points at) is untouched by the migration —
see research.md §5.

## Role, RolePermission, RoleTemplatePermission (existing entities)

**No change.** `role_permissions` and `role_template_permissions` reference `permissions.id`, not
`key` (`apps/api/src/db/schema/roles.ts`). Renaming the `key` column value does not require touching
either of these tables — every existing role's grant set is identical before and after the
migration, by construction.

## TrainingNeed / "Training Request" record (existing entity — `training_needs` table)

**No change.** Per the spec's explicit scope boundary, the underlying table name, its columns
(`title`, `priority`, `department_id`, `status`, `created_by_user_id`, `approved_by_user_id`,
timestamps), indexes, and check constraints (`apps/api/src/db/schema/training-needs.ts`) are
unchanged. Existing submitted/approved/draft records and their history remain fully intact (spec
FR-007) — only the label used to refer to this concept in UI copy and permission-key names changes.

## Custom field attachments (existing entity — Custom Fields Framework, Spec 010)

**No change.** Tenant-configured custom fields attached via `form_definitions`/`form_fields` keyed
to this form continue to resolve exactly as before (spec FR-008) — this feature does not touch the
Custom Fields Framework.
