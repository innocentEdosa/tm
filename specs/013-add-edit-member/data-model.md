# Data Model: Add/Edit Team Member

## Existing entities (unchanged shape, reused as-is)

### `users`

Unchanged. This spec writes to existing columns (`fullName`, `departmentId`) it already had write
access to via `POST /tenant-auth/team` — no new column.

### `roles` / `user_roles`

Unchanged. Role reassignment is a single `UPDATE user_roles SET role_id = ... WHERE user_id = ...`
(research.md §2) — no new column, no new row shape.

### `departments`

Unchanged. Read-only from this spec's perspective (research.md §3).

### `form_definitions` / `form_fields` / `custom_field_values`

Unchanged shape. This spec is the third real consumer of the existing `getFormFields`/
`validateCustomFieldValues`/`writeCustomFieldValues` functions (research.md §5), after Department and
the Team Member Directory's own read-only profile view.

## New: one permission catalog row

| key | display name | category | granted to (role template) |
|---|---|---|---|
| `team.edit` | Edit Team Members | settings | HR/L&D Admin |

Mirrors `0038`/`0040`'s exact `INSERT INTO "permissions"` shape. Org-wide only — no
department-scoped variant (Clarifications, 2026-07-08). Backfilled onto every already-live tenant's
HR/L&D Admin-sourced role (matched by `source_template_id` and by name, same combined approach
`0040` used).

## Derived concepts (not stored, computed per-request or per-render)

- **Department hierarchy path** (e.g. "Engineering > Backend"): computed client-side by walking
  `parentDepartmentId` against the already-fetched flat department list — not persisted, not
  returned by any API response (research.md §3).
- **Role/department validity at write time**: a role id is valid if `SELECT 1 FROM roles WHERE id =
  $roleId` returns a row (RLS already scopes this to the caller's tenant plus global rows, but
  `roles` has no global/tenant-null concept the way `form_fields` does — every non-platform role
  row is tenant-scoped, so a cross-tenant id simply returns no row). A department id is valid if
  `SELECT 1 FROM departments WHERE id = $departmentId AND status = 'active'` returns a row —
  identical check to the one the current `POST` handler already performs, now also applied to the
  new `PATCH` handler and enforced *before* any write (research.md §1).

## API request/response shapes

### `POST /tenant-auth/team` (existing route, extended)

Request body gains one new optional field; `roleId` gains real validation it never had:

```text
{
  fullName: string          // required, unchanged
  email: string             // required, unchanged
  roleId: string             // required, now validated to exist in this tenant
  departmentId?: string      // optional, now validated Active + same tenant
  customFieldValues?: Record<string, unknown>   // new — validated per the Custom Fields Framework
}
```

**New error responses**:
- `422 { success: false, message: "Role not found" }` — `roleId` doesn't resolve.
- `422 { success: false, message: "Department not found or not active" }` — unchanged from today,
  just now checked *before* the user row is written (research.md §1), not after.
- `422 { success: false, errors: FieldValidationError[] }` — custom field validation failure,
  identical shape to Department's own existing error response.

### `PATCH /tenant/team/:userId` (new route)

```text
{
  fullName?: string
  roleId?: string
  departmentId?: string | null   // null explicitly clears the assignment; omitted = unchanged
  customFieldValues?: Record<string, unknown>
}
```

Response (`200`): the same row shape `GET /tenant/team` already returns for this member (so the
frontend can refresh the directory/profile without a second round trip):

```text
{
  success: true,
  data: {
    id, fullName, email, roleName, departmentName, accountStatus, invitedByName, invitedAt
  }
}
```

**Errors**: `403` (missing `team.edit`/`manage_team_members`), `404` (no such member in this
tenant), `422` (invalid role, invalid/archived department, or custom-field validation errors — same
three shapes as `POST` above).
