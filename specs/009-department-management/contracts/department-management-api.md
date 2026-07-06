# Contract: Department Management API

All routes live in a new `apps/api/src/departments/tenant-department-routes.ts` plugin (module path
proposed; finalized in tasks.md), registered in `server.ts` alongside the other tenant-scoped route
plugins. Every route requires `requireTenantUserSession()` first, then the stated permission, and
operates through `request.tenantDb` (RLS-scoped to the caller's own tenant — no route ever takes or
trusts a client-supplied tenant id).

## `GET /tenant/departments`

**Permission**: `department.view` (or `department.manage`, which implies it).

**Query params**: `search?: string` (matches `name`, case-insensitive substring).

**Response** `200`:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Engineering",
      "description": "string | null",
      "status": "active" | "archived",
      "parentDepartmentId": "uuid | null",
      "memberCount": 4,
      "hasChildren": true,
      "manager": { "id": "uuid", "fullName": "string" } | null,
      "assistantManager": { "id": "uuid", "fullName": "string" } | null
    }
  ]
}
```
Returns a flat list with `parentDepartmentId` on each row — the client builds the tree/indentation
client-side (spec FR-001, FR-014). When `search` is provided, the server includes every ancestor of a
matching row even if the ancestor's own name doesn't match, so a nested match is never returned
without its parent context (FR-014) — the client still renders the full returned set as a tree.

**Errors**: `403` if the caller holds neither permission (FR-011/FR-012 — note the nav entry is
additionally hidden client-side, but this check is the authoritative one, independent of that).

---

## `POST /tenant/departments`

**Permission**: `department.manage`.

**Body**: `{ name: string; parentDepartmentId?: string | null; description?: string; managerId?: string | null; assistantManagerId?: string | null }`.

**Behavior**:
1. Reject (`400`) if `name` is missing/blank.
2. Reject (`409`) if `name` duplicates (case-insensitively) an existing department in this tenant
   (FR-004).
3. If `parentDepartmentId` is provided: resolve it through `request.tenantDb` (404/`422` if not
   found — RLS makes a cross-tenant id simply not found, satisfying FR-005/FR-007 by construction);
   reject (`422`, message: `"Cannot set a department as its own parent or descendant"`) if it would
   create a cycle (trivially true on create, since the new row has no descendants yet — this check
   matters on edit, see PATCH below, but the same validation function is shared); reject (`422`,
   message: `"Departments can only be nested up to 3 levels deep"`) if the ancestor chain is already
   2 levels deep (i.e. this would be the 4th).
4. If `managerId` and/or `assistantManagerId` are provided, resolve each through `request.tenantDb`
   (404/`422` if not found — any tenant user is valid, spec FR-019, not restricted to this
   department's members); reject (`422`, message: `"Manager and Assistant Manager must be different
   people"`) if both are provided and equal (FR-020).
5. Insert with `status = 'active'`.

**Response** `201`: the created department, same shape as the list row (`memberCount: 0`,
`hasChildren: false`, `manager`/`assistantManager` reflecting whatever was set, or `null`).

---

## `PATCH /tenant/departments/:departmentId`

**Permission**: `department.manage`.

**Body**: `{ name?: string; parentDepartmentId?: string | null; description?: string; status?: "active" | "archived"; managerId?: string | null; assistantManagerId?: string | null }`.

**Behavior**: Same validation as POST for any field present, plus (specific to edit):
- The cycle check now matters for real: reject if `parentDepartmentId` equals `departmentId` itself, or
  is found in `departmentId`'s own descendant set (a `WITH RECURSIVE` query from `departmentId`
  downward — research.md §3/§7).
- `status` transitions freely between `active`/`archived` with no side effects on children or members
  (spec Assumptions — no cascade).
- `managerId`/`assistantManagerId` may each be set to `null` to clear an existing assignment; the
  same-person check (FR-020) re-validates against whichever of the pair isn't being changed in this
  request (e.g. changing only `managerId` still checks it against the department's *current*
  `assistantManagerId`).

**Response** `200`: the updated department row. `404` if `departmentId` doesn't resolve in this tenant.

---

## `DELETE /tenant/departments/:departmentId`

**Permission**: `department.manage`.

**Behavior**:
1. Compute the subtree member count (`departmentId` + every descendant, research.md §7). If > 0,
   respond `409`:
   ```json
   {
     "success": false,
     "reason": "has_members",
     "memberCount": 3,
     "message": "This department has 3 member(s). Reassign them before deleting.",
     "membersListHref": "/settings/team?department=<departmentId>"
   }
   ```
   (FR-016 — `membersListHref` points at the existing Team Members page; that page does not yet
   filter by department, per research.md §2's flagged limitation).
2. Else if `hasChildren` is true, respond `409`:
   ```json
   { "success": false, "reason": "has_children", "message": "This department has sub-departments. Delete or move them first." }
   ```
3. Else delete the row and respond `200 { "success": true }`.

**Note**: The `department_id`/`parent_department_id` `ON DELETE RESTRICT` foreign keys (data-model.md)
are a defense-in-depth backstop only — this route always checks and reports the specific reason
*before* attempting the delete, so those constraints should never actually fire in normal operation
(no silent generic FK-violation error is ever surfaced to the user, per FR-008's "specific,
distinguishable reason").

---

## `GET /tenant/users?search=`

**Permission**: `department.manage` (exists solely to serve the Manager/Assistant Manager pickers —
research.md §10; not a general-purpose user-directory endpoint).

**Query params**: `search: string` (required, matches `fullName` or `email`, case-insensitive
substring; empty/missing `search` returns `400` rather than the full tenant user list, keeping this
endpoint from becoming an unbounded directory dump).

**Response** `200`:
```json
{ "success": true, "data": [ { "id": "uuid", "fullName": "string", "email": "string" } ] }
```

**Errors**: `403` if the caller lacks `department.manage`.

---

## Non-goals (explicitly out of scope for this contract)

- No bulk/multi-select endpoint (spec FR-018, Clarifications).
- No endpoint here changes `users.department_id` for an *existing* user (no edit-member capability
  exists yet at all in this codebase — research.md §2); that field is only set via the existing
  `POST /tenant-auth/team` route, which gains one optional `departmentId` field as part of this
  feature (contract unchanged in shape otherwise — see that route's existing file).
- No pagination — the full tenant department list is returned in one response (Technical Context —
  scale assumption of tens to low hundreds of rows).
- `GET /tenant/users` is not a Team Directory / user-management endpoint — it returns only
  `id`/`fullName`/`email`, has no list-all mode (search is required), and is gated by
  `department.manage` specifically, not a new general "view users" permission (research.md §10).
