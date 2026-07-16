# Phase 1 Data Model: Super Admin Tenant Console

This feature adds **one new table** and **five new RLS policies**. It adds **no new columns** to any
existing table.

## New table: `member_action_log`

Append-only audit trail for the one write action this feature introduces (spec FR-011). Mirrors
`tenant_action_log`'s shape and access posture exactly (research.md §6), but keyed to a specific
member rather than only a tenant.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK, `default gen_random_uuid()` | |
| `tenant_id` | `uuid`, nullable, `references tenants(id) ON DELETE SET NULL` | Nullable/set-null for the same reason as `tenant_action_log.tenant_id` — a tenant's eventual hard purge (015's grace-period purge script) must not cascade-delete this audit trail. |
| `member_id` | `uuid`, nullable, `references users(id) ON DELETE SET NULL` | The member whose password was reset. Set-null (not cascade) so a later, unrelated deletion of the member row never erases the historical record that a reset occurred. |
| `super_admin_id` | `uuid`, nullable, `references super_admins(id) ON DELETE SET NULL` | Same set-null treatment as `tenant_action_log.super_admin_id` — a Super Admin account being removed later must not block or cascade into this log. |
| `action` | `text` NOT NULL | This spec only ever writes `"password_reset"`; kept as free text (not an enum) to match `tenant_action_log.action`'s own precedent of leaving room for a future action type without a schema migration. |
| `created_at` | `timestamptz` NOT NULL, `default now()` | |

**RLS**: None (platform-level, no `tenant_id`-scoped policy) — identical posture to
`tenant_action_log` and `super_admin_sessions`. Isolation is enforced entirely by every read/write
path being a Super-Admin-only route.

**Grants**: `GRANT SELECT, INSERT ON member_action_log TO tm_app` only — no `UPDATE`/`DELETE`,
matching migration 0056's treatment of `tenant_action_log`. Nothing in this codebase should ever be
able to edit or remove a log entry once written.

**Note on the generated password itself**: the plaintext password is never written to this table (or
anywhere else) — it exists only in the single API response returned to the Super Admin at the moment
of reset (spec Key Entities, Assumptions).

## Modified (RLS only): five existing tables gain `super_admin_full_access`

No column changes. Each of the tables below gains one additive permissive policy, identical shape to
the already-shipped `tenants`/`user_sessions` policies (research.md §3):

```sql
CREATE POLICY "super_admin_full_access" ON "<table>"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
```

| Table | Existing policy (unedited) | Why this feature needs it |
|---|---|---|
| `departments` | `tenant_isolation` (0010) | Console's Departments section reads a tenant's department hierarchy (name, parent, status, manager/assistant manager) via `request.superAdminDb`. |
| `roles` | `tenant_isolation` (0002) | Console's Roles section reads a tenant's role catalog (name, description, `source_template_id` → `isSystem`). |
| `role_permissions` | `tenant_isolation` (0003) | Needed to resolve each role's `permissionKeys` for the Roles section. |
| `user_roles` | `tenant_isolation` (0004) | Needed to resolve each member's role name (Members section) and each role's member count (Roles section, via the reused `getRoleMemberCounts` — research.md §2). |
| `users` | `tenant_isolation` (0011) | Console's Members section reads the directory (name, email, department, account status); the password-reset action additionally **writes** `password_hash` on one row, scoped by an explicit `tenant_id = :id AND id = :memberId` predicate (never relying on ambient RLS scoping — research.md §1). |

`permissions`, `role_templates`, and `role_template_permissions` need no new policy — they carry no
RLS today (platform-global catalogs) and this feature's reads against them are unchanged from how
existing tenant-scoped routes already read them.

## Read-model shapes (not new tables — response shapes for the new routes; see contracts/)

- **Tenant detail** (Company tab): reuses the same field set as Tenant Management's existing list
  row (`id`, `name`, `subdomain`, `status`, `isArchived`, `isPendingDeletion`, `primaryContactName`,
  `primaryContactEmail`, `createdAt`) — no new shape invented.
- **Department row**: same shape as `GET /tenant/departments`'s existing response row (`id`, `name`,
  `description`, `status`, `parentDepartmentId`, `memberCount`, `hasChildren`, `manager`,
  `assistantManager`) — same field names, computed fresh by this feature's own tenant-filtered query
  (research.md §1), not by importing the existing handler.
- **Role row**: same shape as `GET /tenant/roles`'s existing response row (`id`, `name`,
  `description`, `permissionKeys`, `isSystem`, `memberCount`).
- **Member row**: same shape as `GET /tenant/team`'s existing response row (`id`, `fullName`,
  `email`, `roleName`, `departmentName`, `accountStatus`) — the `invitedByName`/`invitedAt` fields from
  that contract are omitted here (not needed by this console; can be added later without a breaking
  change if requested).
- **Password-reset result**: `{ generatedPassword: string }` — returned once, by the one write route,
  never persisted (see `member_action_log` note above).
