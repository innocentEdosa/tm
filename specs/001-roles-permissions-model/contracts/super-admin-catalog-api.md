# Contract: Super Admin — Permission Catalog & Role Template View

Fastify JSON endpoints backing spec User Story 1 (P1) and the feature's demoable slice (FR-013). Read
-only for this spec — no endpoint here creates, edits, or deletes catalog data (that only happens via
migrations, per FR-002).

All endpoints require the caller's session to resolve to the platform-level Super Admin role
(`roles.tenant_id IS NULL`). They are **not** tenant-scoped requests, so the per-request tenant
transaction from research.md §3 does not apply here — these run against the platform connection
context, not inside a `SET LOCAL app.tenant_id` transaction.

## `GET /admin/permissions`

Returns the full platform permission catalog.

**Response `200`**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "key": "approve_enrollment",
      "displayName": "Approve Enrollment",
      "description": "Approve a learner's enrollment request into a course.",
      "category": "enrollment"
    }
  ]
}
```

**Response `403`**: caller is authenticated but not Super Admin.
```json
{ "success": false, "message": "Forbidden" }
```

## `GET /admin/role-templates`

Returns the default role templates with their permission mappings.

**Response `200`**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "key": "hr_admin",
      "name": "HR/L&D Admin",
      "description": "Full access to course, enrollment, and department administration.",
      "isPlatformOnly": false,
      "permissions": ["approve_enrollment", "edit_content_library", "view_department_analytics"]
    },
    {
      "id": "uuid",
      "key": "super_admin",
      "name": "Super Admin",
      "description": "Platform operator role. Not assignable within any tenant.",
      "isPlatformOnly": true,
      "permissions": ["..."]
    }
  ]
}
```

**Response `403`**: same as above.

## Error shape

Both endpoints use the shared `ApiResponse<T>` / `ApiError` shapes already defined in
`packages/types/src/index.ts` — no new shared type package is needed for this contract.
