# Contract Amendment: `GET /tenant-auth/me`

Originally documented in `specs/005-tenant-auth-config/contracts/tenant-auth-api.md` (left unedited,
as a historical record of that spec — Spec 4 → Spec 5 established the precedent of amending a prior
spec's endpoint in the new spec's own docs rather than rewriting the old one). This file documents
what Spec 6 adds on top of it.

## `GET /tenant-auth/me?subdomain=acmecorp`

Unchanged: requires a valid session (any state, including `must_change_password: true`).

**Response shape, amended**:

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "jo@acmecorp.example",
    "mustChangePassword": false,
    "roleName": "HR/L&D Admin",
    "permissions": ["manage_team_members", "manage_authentication_settings", "manage_roles"]
  }
}
```

- **`roleName`**: `string | null`. `null` only if the user has zero role assignments (see Edge Cases
  below) — should not occur in practice per spec Assumptions (every account is created with exactly
  one role), but the field is nullable so the frontend can render FR-008's error state rather than
  crash on an unexpected `null`.
- **`permissions`**: `string[]`, always present, possibly empty. The union of every permission key
  reachable through any role the user holds (data-model.md).

Both fields are additive — no existing field changes shape or meaning. Existing consumers of `/me`
(Spec 5's `tenant/page.tsx`, `set-password/page.tsx`) are unaffected if they ignore the new fields.

## New consumer contract: `apps/web/app/dashboard/layout.tsx`

Not a new HTTP endpoint — a Server Component contract, documented here since it's the primary new
consumer of the amended `/me` response.

- On no session / invalid session: redirects to `/tenant` (same precedent as `set-password/page.tsx`).
- On valid session with `mustChangePassword: true`: redirects to `/set-password` (same precedent as
  `tenant/page.tsx`).
- On valid session with `mustChangePassword: false`: renders the sidebar using `roleName` and
  `permissions` from `/me`, then renders `{children}` (the nested `page.tsx`) in the main content area.
- If `roleName` is `null` (the zero-roles edge case): renders a clear, actionable error state instead
  of the sidebar/children (FR-008) — "Your account isn't assigned a role yet — contact your HR Admin."
