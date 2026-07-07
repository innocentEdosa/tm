# API Contract: Team Member Directory

All routes operate through `request.tenantDb` (RLS-scoped). One route below is new — no existing
route's shape changes (the existing `POST /tenant-auth/team` is untouched except for internally also
setting the new `invited_by` column, which is not part of its request/response contract). Invite
metadata is included directly on each list row rather than a separate detail endpoint (data-model.md);
the expanded row's custom fields are lazy-loaded via the existing, already-generic
`GET /tenant/custom-field-values` endpoint (see Reused routes below), not a new endpoint.

## `GET /tenant/team`

**Gate**: `requireAnyPermission("team.view.all", "team.view.department")`

**Query parameters**:

| Param | Type | Required | Notes |
|---|---|---|---|
| `search` | string | no | Matches against `fullName`/`email`, case-insensitive substring |
| `departmentId` | uuid | no | Only meaningful for `team.view.all` holders (FR-009); a `team.view.department`-only caller passing this param has it ignored — their own subtree scope always wins, never expanded or overridden by client input |
| `page` | integer | no, default `1` | 1-indexed |
| `pageSize` | integer | no, default `25` | |

**Visibility enforcement** (server-side, never client-filtered):
- Caller holds `team.view.all` → no department restriction; `departmentId` param (if present) is
  applied via `collectSubtreeIds(departmentId)` as an additional narrowing filter.
- Caller holds only `team.view.department` → caller's own `departmentId` is looked up
  (`SELECT department_id FROM users WHERE id = request.user.id`); if `NULL`, return the "no
  department assigned" empty state (`200` with `data: []`, `meta.reason: "no_department_assigned"`);
  otherwise scope to `collectSubtreeIds(ownDepartmentId)`, ignoring any client-supplied
  `departmentId`.

**Response** (`200`):

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
      "accountStatus": "invited | active",
      "invitedByName": "string | null",
      "invitedAt": "ISO-8601 timestamp"
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 25,
    "total": 0,
    "reason": "no_department_assigned | null"
  }
}
```

**Errors**:
- `403` — caller holds neither `team.view.all` nor `team.view.department`.

## Reused, unchanged existing route

- `GET /tenant/custom-field-values?formKey=member&entityId=<userId>` — already generic
  (`requireTenantUserSession()` only, no extra permission — spec 010 FR-010's own accepted design:
  a *known* entityId's custom field values are readable tenant-wide, only the action of editing them
  is permission-gated), used by the frontend to lazy-load the expandable row's custom field values
  exactly as Department's own detail view already uses it for `formKey=department`. This spec adds
  no new access-control layer on top of that pre-existing, accepted behavior — not re-specified here
  since its contract is unchanged. `entityId` here is the member's own `users.id`.
