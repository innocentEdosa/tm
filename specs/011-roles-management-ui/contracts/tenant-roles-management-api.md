# Contract: Tenant Roles Management API

Extends `apps/api/src/permissions/tenant-role-routes.ts` (existing, Spec 001). Every route below
operates through `request.tenantDb` (RLS-scoped) and is gated by `requirePermission("manage_roles")`
— that single preHandler, matching this file's own existing convention (it already checks
`request.user` itself; no separate `requireTenantUserSession()` needed alongside it here).

## `GET /tenant/roles` *(new)*

**Response** `200`:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "HR/L&D Admin",
      "description": "string | null",
      "permissionKeys": ["manage_roles", "department.view", "..."],
      "isSystem": true,
      "memberCount": 3
    },
    {
      "id": "uuid",
      "name": "Content Reviewer",
      "description": null,
      "permissionKeys": ["edit_content_library"],
      "isSystem": false,
      "memberCount": 0
    }
  ]
}
```
Ordering: no specific server-side order is required by the spec; the frontend may sort (e.g. system
roles first, then custom roles alphabetically) without a corresponding API contract requirement.

## `GET /tenant/permission-catalog` *(new)*

**Response** `200`:
```json
{
  "success": true,
  "data": [
    { "id": "uuid", "key": "manage_roles", "displayName": "Manage Roles", "description": "...", "category": "roles" },
    { "id": "uuid", "key": "department.view", "displayName": "View Departments", "description": "...", "category": "department" }
  ]
}
```
Flat list, same shape as the existing Super-Admin-only `GET /admin/permissions` — grouping by
`category` is a frontend concern (data-model.md).

## `POST /tenant/roles` *(existing, unchanged)*

**Body**: `{ name: string; description?: string; permissionKeys?: string[] }`.
**Response** `201` with the created role, or `409 { message: "Role name already exists" }` on a
duplicate `(tenant_id, name)`. No member-count/impact-warning concern applies to create (spec: "no
warning needed since no members are assigned yet").

## `PATCH /tenant/roles/:roleId` *(existing route, gains a new guard)*

**Behavior change**: Before any write, if the resolved role's `sourceTemplateId` is not null, reject
with:

**Response** `403`:
```json
{ "success": false, "message": "System roles cannot be modified." }
```

Otherwise unchanged: `{ name?: string; description?: string; permissionKeys?: string[] }` body,
`200` with the updated role. This route does not itself decide whether to show the frontend's
impact-warning dialog — that's a client-side decision made from `GET /tenant/roles`'s `memberCount`
*before* calling this endpoint (spec FR-010/FR-011); the endpoint's own behavior is identical whether
or not the dialog was shown.

## `DELETE /tenant/roles/:roleId` *(existing route, gains the same new guard)*

**Behavior change**: Same `sourceTemplateId IS NOT NULL` check as `PATCH`, same `403` response, checked
*before* the existing member-assignment check (so a system role with zero members still correctly
reports "cannot be modified," not silently succeeds).

**Existing behavior, unchanged**: `409 { message: "Role has users assigned; reassign them before
deleting." }` when `user_roles` still references this role; `204` on success.

**Frontend addition** (no API contract change): the blocked-delete UI surfaces the exact member count
by first reading `GET /tenant/roles`'s `memberCount` for that role (not by parsing the `409` body,
which the existing route doesn't itself carry a count in) — see quickstart.md for the exact flow — and
links toward `/settings/team?role=<roleId>`, mirroring Department's own `membersListHref` pattern
(neither link actually filters the Members list today; spec Assumptions).

## Non-goals (explicitly out of scope for this contract)

- No endpoint changes to permission *key* creation — the catalog is still seeded exclusively via
  migration, per module, unchanged by this spec.
- No bulk role-assignment endpoint — single-member assignment via the existing Members/invite flow is
  unchanged and out of scope here.
- No new endpoint for reassigning a role's members away from it before deletion — that's the existing
  Members screen's own edit flow, unchanged by this spec.
