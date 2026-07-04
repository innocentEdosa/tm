# Data Model: Role-Based Dashboard Shell

No new tables, columns, or migrations. This feature reads existing data only.

## Existing entities read by this feature

### `users` (Spec 2/5, unchanged)

Read for `id`, `email` — already how `/tenant-auth/me` identifies the session's account.

### `roles` / `user_roles` / `role_permissions` / `permissions` (Spec 1, unchanged)

Read (never written) to derive two new response fields on the existing `/tenant-auth/me` endpoint:

- **`roleName`**: the name of the first `role` a `user_roles` row links the session's user to
  (ordered by `user_roles.created_at`). Per spec Assumptions, a user holds exactly one role in
  practice; this feature does not enforce that constraint, only reads under the assumption it holds.
- **`permissions`**: the union of every `permissions.key` reachable through any role the user holds,
  via the existing `resolveEffectivePermissions()` helper (`apps/api/src/permissions/effective-permissions.ts`).
  Empty array if the user has no roles (deny-by-default, consistent with `requirePermission()`'s own
  default).

Both are computed by a single new query scoped through `request.tenantDb`, which is already
RLS-restricted to the caller's own tenant (Spec 1's `tenant_isolation` policy) — no new RLS policy is
introduced by this feature.

## Derived concept (not a table): Sidebar entry visibility

A pure function of `permissions: string[]` (already returned by `/tenant-auth/me`) — not persisted
anywhere, computed fresh on every render from the session data described above:

| Entry | Requires permission key | Behavior if absent |
|---|---|---|
| Home | *(none)* | always shown |
| Team Members | `manage_team_members` | entry omitted |
| Authentication Settings | `manage_authentication_settings` | entry omitted |
| Courses | *(none)* | always shown, rendered disabled/"coming soon" |
