# Contract: Super Admin Tenant Console API

All routes live in a new `apps/api/src/super-admin-tenant-console/super-admin-tenant-console-routes.ts`
plugin, registered in `server.ts` alongside the existing `tenant-management-routes.ts`. Every route
requires `requireSuperAdminSession` and operates exclusively through `request.superAdminDb!` — never
`fastify.pg.pool` or `request.tenantDb`. Every route below explicitly filters by the `:id` (tenant) and,
where present, `:memberId` route params — see plan.md's Summary and research.md §1 for why this is
load-bearing (`request.superAdminDb` is not implicitly scoped to one tenant).

Per spec FR-013 (resolved Clarification), **no route in this contract checks tenant status**
(Active/Trial/Archived/Suspended/Pending-Deletion) — every route here works identically regardless of
the target tenant's current status. This is a deliberate difference from `tenant-management-routes.ts`'s
`editTenant`, which does reject archived/pending-deletion tenants for company-detail edits — that
restriction is specific to Spec 015's edit action and does not apply here.

## `GET /tenants/:id`

**Purpose**: Company-details data for the console's Company tab (spec FR-003).

**Response** `200`:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "string",
    "subdomain": "string",
    "status": "trial | active | suspended | cancelled",
    "isArchived": true,
    "isPendingDeletion": false,
    "primaryContactName": "string",
    "primaryContactEmail": "string",
    "createdAt": "ISO-8601 timestamp"
  }
}
```
Same field set as Tenant Management's existing list row (015) — no new shape.

**Errors**: `404 { "success": false, "message": "Tenant not found" }` if `:id` does not resolve (never
found for another tenant's data — RLS plus the explicit filter make a wrong id indistinguishable from
a missing one).

---

## `GET /tenants/:id/departments`

**Purpose**: Department hierarchy for the console's Departments tab (spec FR-004), read-only.

**Response** `200`: identical row shape to the existing `GET /tenant/departments`
(`specs/009-department-management/contracts/department-management-api.md`):
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Engineering",
      "description": "string | null",
      "status": "active | archived",
      "parentDepartmentId": "uuid | null",
      "memberCount": 4,
      "hasChildren": true,
      "manager": { "id": "uuid", "fullName": "string" } | null,
      "assistantManager": { "id": "uuid", "fullName": "string" } | null
    }
  ]
}
```
Flat list, `tenant_id = :id` filtered explicitly in the query (research.md §1) — the client builds
the tree/indentation client-side, same as Spec 009's own frontend.

**Errors**: `404` if `:id` does not resolve to a tenant. An empty `data: []` (not an error) if the
tenant has zero departments.

---

## `GET /tenants/:id/roles`

**Purpose**: Role/permission catalog for the console's Roles tab (spec FR-005), read-only.

**Response** `200`: identical row shape to the existing `GET /tenant/roles`
(`specs/011-roles-management-ui/contracts/tenant-roles-management-api.md`):
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "HR/L&D Admin",
      "description": "string | null",
      "permissionKeys": ["manage_roles", "department.view"],
      "isSystem": true,
      "memberCount": 3
    }
  ]
}
```
`roles`/`role_permissions` queried with `tenant_id = :id` filtered explicitly; `memberCount` computed
via the existing `getRoleMemberCounts` helper, safely reusable unmodified against
`request.superAdminDb` (research.md §2) since it is intersected only against this tenant's own role
ids.

**Errors**: `404` if `:id` does not resolve to a tenant. An empty `data: []` if the tenant has zero
custom roles (the platform-level `tenant_id IS NULL` Super Admin role is never included — this
endpoint filters strictly to `tenant_id = :id`).

---

## `GET /tenants/:id/members`

**Purpose**: Member directory for the console's Members tab (spec FR-006), read-only except for the
password-reset action below.

**Query params**: `search?: string`, `page?: number` (default 1), `pageSize?: number` (default 25) —
same pagination convention as the existing Tenants list and Team Directory.

**Response** `200`: same row shape as the existing `GET /tenant/team`
(`specs/012-team-member-directory/contracts/team-directory-api.md`), minus the invite-metadata fields
(not needed by this console):
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "fullName": "string",
      "email": "string",
      "roleName": "string",
      "departmentName": "string | null",
      "accountStatus": "invited | active"
    }
  ],
  "meta": { "page": 1, "pageSize": 25, "total": 0 }
}
```
No visibility-scope narrowing of the kind `GET /tenant/team` applies for `team.view.department`
holders — a Super Admin viewing this console always sees every member of the tenant (this is a
platform capability, not a tenant-permission-gated one).

**Errors**: `404` if `:id` does not resolve to a tenant.

---

## `POST /tenants/:id/members/:memberId/reset-password`

**Purpose**: The one write action in scope (spec FR-008/FR-009/FR-010/FR-011).

**Behavior**:
1. Resolve `:memberId` scoped to `tenant_id = :id` — if no such member exists (wrong tenant, wrong id,
   or archived member — archived members ARE eligible per spec FR-013's "any status" resolution),
   respond `404`.
2. Generate a new random password (`generate-password.ts`, research.md §4) and hash it
   (`hashPassword`, existing scrypt-based helper).
3. Update that member's `users.password_hash` to the new hash. Do **not** set `must_change_password`
   (spec Clarifications: not forced) and do **not** touch `otp_expires_at` (this is not an OTP flow).
4. Invalidate every currently-active session for that member (`revokeUserSessions`, research.md §5) —
   in the same transaction as step 3.
5. Insert one row into `member_action_log` (`tenant_id`, `member_id`, `super_admin_id`,
   `action: "password_reset"`) — same transaction.
6. Return the plaintext generated password once. It is never persisted or logged anywhere else.

**Response** `200`:
```json
{ "success": true, "data": { "generatedPassword": "string" } }
```

**Errors**: `404 { "success": false, "message": "Member not found" }` if `:id`/`:memberId` don't
resolve together.

**Explicitly not sent**: no email, no reset link, no token — this route bypasses the existing
email/token-based reset flow (Spec 016/018) entirely, per spec FR-008.

---

## Non-goals (explicitly out of scope for this contract)

- No `PATCH`/`POST`/`DELETE` against `departments`, `roles`, or any member field other than
  `password_hash` — editing any of those stays exclusively in each tenant's own UI (spec FR-014).
- No bulk password-reset endpoint (spec Out of Scope).
- No "view as member" session-issuing endpoint — this contract never creates a tenant-user session
  (spec FR-015).
- No dedicated audit-log read endpoint for `member_action_log` — the log is written by step 5 above
  but has no listing route in this spec (spec Out of Scope: "a dedicated audit-log screen").
