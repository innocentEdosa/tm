# Data Model: Team Member Directory (List View)

## Existing entities (unchanged shape, reused as-is)

### `users`

Already tenant-scoped, already carries every core column this view needs: `id`, `tenantId`,
`fullName`, `email`, `mustChangePassword`, `departmentId` (nullable, FK → `departments.id`),
`createdAt`. One column is added (below); nothing else about this table's shape changes.

### `departments`

Unchanged. This feature only reads it (directly, and via the existing `collectSubtreeIds` helper)
to resolve a department's descendants for both visibility scoping and the filter dropdown.

### `roles` / `user_roles`

Unchanged. A member's role name for the "Role" column comes from the existing join already used
elsewhere in this codebase (`user_roles` → `roles`).

### `form_definitions` / `form_fields` / `custom_field_values`

Unchanged shape. One new *row* is added to `form_definitions` (below), not a schema change.

## New: `users.invited_by`

| Column | Type | Notes |
|---|---|---|
| `invited_by` | `uuid`, nullable | FK → `users.id`, `onDelete: "set null"` |

- Populated by the existing `POST /tenant-auth/team` handler at member-creation time, set to the
  creating (inviting) user's own id.
- `NULL` on every row created before this migration — no retroactive backfill is possible (research.md §2).
- `onDelete: "set null"` (not `restrict`) — deleting the inviting user's own account must not block
  or cascade-delete the members they invited; it should simply leave this pointer empty going
  forward, the same non-destructive default already used for optional provenance-only pointers
  elsewhere in this schema (e.g. `roles.source_template_id`).

## New: `form_definitions` row — `key: 'member'`

One additive seed row, mirroring `0030_seed_department_form_definition.sql` exactly. No new columns,
no new table. This is the anchor every tenant-configured "member" custom field (Personnel Number,
DOB, Nationality, etc. — per the spec's Prevoli-sample context) attaches to via the existing
`form_fields.formDefinitionId` FK, exactly like Department's own fields attach to the `department`
form_definition row today.

## New: two permission catalog rows

| key | display name | category | granted to (role template) |
|---|---|---|---|
| `team.view.all` | View All Team Members | settings | HR/L&D Admin |
| `team.view.department` | View Department Team Members | settings | Manager |

Mirrors the exact shape of `0038_seed_granular_crud_permissions.sql`'s own `INSERT INTO
"permissions"` statement. Backfilled onto every already-live tenant's HR/L&D Admin and Manager
roles (matched by `source_template_id` and by name, the same combined approach `0038` used).

## Derived concepts (not stored, computed per-request)

- **Viewer's effective visibility scope**: `team.view.all` → no department filter at all (every
  member in the tenant). `team.view.department` (and not `team.view.all`) → the viewer's own
  `departmentId` (looked up once per request, research.md §6) passed through the existing
  `collectSubtreeIds`, producing the exact set of department ids the `WHERE department_id IN (...)`
  clause scopes to. Neither permission → the route itself returns 403 before any query runs
  (`requireAnyPermission("team.view.all", "team.view.department")` as the route's preHandler).
- **Account status** (display-only, not stored): `mustChangePassword === true` → "Invited";
  `mustChangePassword === false` → "Active." "Suspended" is not derivable from any current column
  (research.md §2) — the column is reserved in the response shape below for forward compatibility
  once a future spec introduces the underlying capability, but no member can display it today.
- **Department filter's effective set** (org-wide viewers only): selecting one department in the
  dropdown resolves to that department's own id plus every descendant via the same
  `collectSubtreeIds` call used for visibility scoping — one shared code path serves both purposes.

## API response shape — member list row

Invite metadata (`invitedByName`/`invitedAt`) is included directly on the list row itself — cheap
via one extra self-join to `users` — rather than a separate per-row detail fetch. Custom field
values are deliberately *not* included here (a tenant could have many members and many fields;
fetching every value for every row up front doesn't scale) — the profile panel lazy-loads those via
the existing, already-generic `GET /tenant/custom-field-values` endpoint instead (see below).

```text
{
  id: string
  fullName: string
  email: string
  roleName: string
  departmentName: string | null   // null when the member has no department assigned
  accountStatus: "invited" | "active"   // "suspended" reserved, never emitted today
  invitedByName: string | null    // null if invited_by is null (pre-existing member, or self-provisioned admin)
  invitedAt: string                // ISO timestamp, from existing createdAt
}
```
