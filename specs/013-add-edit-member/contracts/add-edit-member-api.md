# API Contract: Add/Edit Team Member

All routes operate through `request.tenantDb` (RLS-scoped). Both routes below validate role and
department server-side *before* any write — never trusting a dropdown's own client-side filtering
as the actual security boundary (plan.md's own Constraints).

## `POST /tenant-auth/team` (existing route, extended)

**Gate**: `requireAnyPermission("manage_team_members", "team.create")` — unchanged.

**Body**:

| Field | Type | Required | Notes |
|---|---|---|---|
| `fullName` | string | yes | unchanged |
| `email` | string | yes | unchanged |
| `roleId` | uuid | yes | **new**: validated to exist in the caller's own tenant before the user row is created |
| `departmentId` | uuid | no | validated Active + same tenant (unchanged rule, now checked earlier) |
| `customFieldValues` | object | no | **new**: validated per the "member" form's configured fields |

**Validation order** (all before any write, research.md §1): (1) required fields present, (2) role
exists in tenant, (3) department (if given) exists and is Active, (4) custom field values pass
`validateCustomFieldValues`. Only after all four pass does the `users` insert happen, followed by
the `user_roles` insert and, if provided, `writeCustomFieldValues`.

**Response** (`201`, unchanged): `{ success: true, data: { id, email } }`

**Errors**:
- `400` — missing required field (unchanged).
- `422 { success: false, message: "Role not found" }` — **new**.
- `422 { success: false, message: "Department not found or not active" }` — unchanged message, now
  raised before any write.
- `422 { success: false, errors: FieldValidationError[] }` — **new**, custom field validation.
- `409` — duplicate email at the same tenant (unchanged).

## `PATCH /tenant/team/:userId` (new)

**Gate**: `requireAnyPermission("manage_team_members", "team.edit")`.

**Body** (all fields optional — only supplied fields are changed):

| Field | Type | Notes |
|---|---|---|
| `fullName` | string | |
| `roleId` | uuid | validated to exist in the caller's own tenant |
| `departmentId` | uuid \| null | `null` clears the assignment; validated Active + same tenant when non-null; omitted field leaves the current assignment untouched |
| `customFieldValues` | object | validated per the "member" form's configured fields; only submitted keys are written (existing Custom Fields Framework behavior, unchanged) |

**Validation order**: same as `POST` — everything validated before any write, using this same
tenant's already-loaded member row's current state (e.g. current department) is not required for
validation itself, only for rendering the pre-filled form.

**Response** (`200`):

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "fullName": "string",
    "email": "string",
    "roleId": "uuid",
    "roleName": "string",
    "departmentId": "uuid | null",
    "departmentName": "string | null",
    "accountStatus": "invited | active",
    "invitedByName": "string | null",
    "invitedAt": "ISO-8601 timestamp"
  }
}
```

Same row shape `GET /tenant/team` already returns, so the frontend can refresh in place without a
second fetch.

**Errors**:
- `403` — caller holds neither `manage_team_members` nor `team.edit`.
- `404` — no member with this `userId` exists in the caller's own tenant.
- `422 { success: false, message: "Role not found" }`
- `422 { success: false, message: "Department not found or not active" }`
- `422 { success: false, errors: FieldValidationError[] }`

## Reused, unchanged existing routes

- `GET /tenant/roles` — populates the Role dropdown (both create and edit). Gated
  `requireAnyPermission("manage_roles", "roles.read")` — an existing, already-accepted dependency
  (research.md §4), not introduced by this spec.
- `GET /tenant/departments` — populates the Department dropdown, filtered client-side to
  `status === "active"` and rendered with a client-computed ancestor path (research.md §3). Gated
  `requirePermission("department.view")` — same existing dependency the current form already has.
- `GET /tenant/form-fields?formKey=member` — populates the dynamic custom-field list, already used
  by this same screen's read-only profile view (spec 012).
- `GET /tenant/custom-field-values?formKey=member&entityId=<userId>` — populates existing values when
  opening the edit form, already used by the read-only profile view.
