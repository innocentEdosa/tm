# Contract: Tenant Role Management API

Fastify JSON endpoints backing spec User Story 3 (P3) — per-tenant role customization (FR-006). All
endpoints run inside the request's tenant-scoped transaction (`request.tenantDb`, research.md §2–3),
so RLS already restricts every operation to the caller's own tenant. All endpoints are guarded by
`requirePermission("manage_roles")`.

## `PATCH /tenant/roles/:roleId`

Renames a role, updates its description, and/or replaces its permission set.

**Request body**:
```json
{
  "name": "Team Lead",
  "description": "Optional updated description",
  "permissionKeys": ["approve_enrollment", "view_department_analytics"]
}
```
All fields optional; omit a field to leave it unchanged. `permissionKeys`, when present, fully replaces
the role's current permission set (not a merge).

**Response `200`**:
```json
{ "success": true, "data": { "id": "uuid", "name": "Team Lead", "permissionKeys": ["..."] } }
```

**Response `404`**: `roleId` does not resolve to a role visible in the caller's tenant (this includes
the platform Super Admin role, which is never visible through this endpoint — FR-007).

**Response `403`**: caller lacks `manage_roles`.

## `POST /tenant/roles`

Creates a new role from selected catalog permissions.

**Request body**:
```json
{ "name": "Onboarding Buddy", "description": "...", "permissionKeys": ["view_department_analytics"] }
```

**Response `201`**:
```json
{ "success": true, "data": { "id": "uuid", "name": "Onboarding Buddy", "permissionKeys": ["..."] } }
```

**Response `409`**: a role with that `name` already exists in the caller's tenant (unique
`(tenant_id, name)`).

## `DELETE /tenant/roles/:roleId`

Deletes a role, provided no users are still assigned to it (FR-012).

**Response `204`**: deleted.

**Response `409`**:
```json
{ "success": false, "message": "Role has users assigned; reassign them before deleting." }
```

**Response `404`**: same as `PATCH` — not found in the caller's tenant, including the Super Admin role.

## Error shape

All endpoints use the shared `ApiResponse<T>` / `ApiError` shapes already defined in
`packages/types/src/index.ts` — no new shared type package is needed for this contract.
