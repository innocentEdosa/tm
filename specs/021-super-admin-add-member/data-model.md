# Phase 1 Data Model: Super Admin Add Member

This feature adds **no new table, no new column, and no new RLS policy**. It writes to two existing
tables using RLS access already granted by Spec 020.

## Modified (data only — no schema change): `users`, `user_roles`

| Table | Existing policy exercised | What this feature writes |
|---|---|---|
| `users` | `super_admin_full_access` (migration 0063, `WITH CHECK` already permits `INSERT`) | One new row: `tenant_id` (from the route's `:id`), `full_name`, `email`, `password_hash` (hash of a generated OTP), `must_change_password: true`, `otp_expires_at`, `department_id` (nullable), `invited_by: NULL` (see below). |
| `user_roles` | `super_admin_full_access` (migration 0062, `WITH CHECK` already permits `INSERT`) | One new row: `tenant_id`, `user_id` (the newly created member), `role_id` (validated to belong to this tenant first). |

**`invited_by` is deliberately `NULL`** for a member created this way (spec FR-007, Assumptions) — a
Super Admin has no `users.id` row to reference (that column only ever points to another tenant-scoped
user). The existing Team Directory UI already renders a blank/"—" value for a null inviter, so this
requires no UI change elsewhere.

## Modified (data only): `member_action_log` (Spec 020)

No column change — this feature writes a new value into the existing free-text `action` column:

| Column | Value written by this feature |
|---|---|
| `tenant_id` | The target tenant's id. |
| `member_id` | The newly created member's id. |
| `super_admin_id` | The acting Super Admin's id. |
| `action` | `"member_added"` (new value alongside the existing `"password_reset"`). |
| `created_at` | Default (`now()`). |

## Read-only inputs (not modified, just validated against): `roles`, `departments`

- **Role**: must exist with `tenant_id = :id` (the route's tenant). Validated via a new, local,
  explicitly-tenant-filtered `roleExistsForTenant` — see research.md §1 for why the existing
  `roleExists` helper cannot be reused unmodified here.
- **Department** (optional): if provided, must exist with `tenant_id = :id` AND `status = 'active'`.
  Validated via a new, local `departmentIsActiveForTenant`, same reasoning as above.

## Request/response shape (not a new entity — see contracts/)

- **Add Member input**: `{ fullName: string; email: string; roleId: string; departmentId?: string }`.
- **Add Member result**: `{ id: string; email: string }` — same shape the existing
  `POST /tenant-auth/team` already returns.
