# Contract: Super Admin Add Member API

Adds one route to the existing
`apps/api/src/super-admin-tenant-console/super-admin-tenant-console-routes.ts` plugin (Spec 020).
Requires `requireSuperAdminSession` and operates exclusively through `request.superAdminDb!`, same as
every other route in that file. Explicitly filters by the `:id` route param — see plan.md's Summary
and research.md §1 for why this is load-bearing.

Per spec FR-010, this route works identically regardless of the target tenant's status
(Active/Trial/Archived/Suspended/Pending-Deletion) — no status check is performed.

## `POST /tenants/:id/members`

**Purpose**: Create a new member of the tenant `:id` (spec FR-001–FR-006), reusing the tenant-side
member-creation mechanism (Specs 012/013) unchanged in substance.

**Body**:
```json
{
  "fullName": "string",
  "email": "string",
  "roleId": "uuid",
  "departmentId": "uuid | omitted"
}
```

**Behavior** (mirrors `POST /tenant-auth/team`'s own order exactly, applied via `request.superAdminDb`
with explicit tenant filtering):
1. `400` if `fullName`, `email`, or `roleId` is missing.
2. `422 { message: "Role not found" }` if `roleId` does not resolve with `tenant_id = :id`
   (`roleExistsForTenant`, research.md §1).
3. `422 { message: "Department not found or not active" }` if `departmentId` is given and does not
   resolve to an active department with `tenant_id = :id` (`departmentIsActiveForTenant`).
4. Generate a one-time password (`generateOneTimePassword`) and its hash (`hashPassword`).
5. Insert the `users` row: `tenant_id: :id`, `full_name`, `email` (trimmed, lower-cased),
   `password_hash`, `must_change_password: true`, `otp_expires_at` (`otpExpiryFromNow()`),
   `department_id: departmentId ?? null`, `invited_by: null`.
   - On a unique-constraint violation (`(tenant_id, email)`): `409 { message: "Email already in use at this tenant" }`.
6. Insert the `user_roles` row (`tenant_id`, `user_id`, `role_id`).
7. Look up the tenant's `name` (via `request.superAdminDb`, filtered by `:id`) and call
   `sendMemberInviteEmail(email, oneTimePassword, tenantName)` — never blocks or fails the response
   (research.md §3).
8. Insert one `member_action_log` row: `tenant_id: :id`, `member_id`, `super_admin_id`,
   `action: "member_added"`.
9. Respond `201`.

**Response** `201`:
```json
{ "success": true, "data": { "id": "uuid", "email": "string" } }
```

**Errors**:
- `400 { success: false, message: "fullName, email, and roleId are required" }`
- `404 { success: false, message: "Tenant not found" }` if `:id` does not resolve to any tenant.
- `422 { success: false, message: "Role not found" }`
- `422 { success: false, message: "Department not found or not active" }`
- `409 { success: false, message: "Email already in use at this tenant" }`

## Non-goals (explicitly out of scope for this contract)

- No custom field values accepted at creation time (spec FR-012).
- No editing of an existing member's role, department, or details through this or any other console
  route (Spec 020 FR-014 remains fully intact).
- No resend/revoke-invite endpoint — doesn't exist anywhere in this codebase today (Spec 012
  Non-goals), unchanged by this feature.
- No bulk/CSV import.
