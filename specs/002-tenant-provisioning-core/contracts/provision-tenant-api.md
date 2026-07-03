# Contract: `POST /provisioning/tenants`

> **Superseded, 2026-07-03**: the guard described below (`requirePlatformPermission`, backed by the
> `roles.tenant_id IS NULL` platform role and the retired `tm_platform_reader` role) now reads
> `requireSuperAdminSession` from the Super Admin Authentication spec — a real session against the
> dedicated `super_admins` table. The **`403`** "Forbidden" response documented below is now
> **`401`** "Unauthorized" in practice; Super Admin access is a binary check, no longer tied to the
> `provision_tenant` catalog permission. Kept here for historical record; see
> `specs/003-super-admin-authentication/contracts/platform-auth-api.md`.

The single Fastify JSON endpoint backing this spec's entire flow (User Stories 1–3): company details,
department setup, and initial admin creation with role assignment, submitted once and applied
atomically (research.md §3; spec FR-013).

Requires the caller's session to resolve to the platform-level Super Admin role and hold the
`provision_tenant` permission (`requirePlatformPermission("provision_tenant")` —
research.md §7). Not tenant-scoped: this route does not use `request.tenantDb` — the per-request
tenant-context plugin does not apply here, since no tenant exists yet at the start of the request
(research.md §1). It opens and manages its own transaction directly against `fastify.pg.pool`.

## Request

```json
{
  "company": {
    "name": "Acme Corp",
    "subdomain": "acme",
    "industry": "Manufacturing",
    "primaryContact": {
      "name": "Jordan Lee",
      "email": "jordan.lee@acme.example",
      "phone": "+1-555-0100"
    }
  },
  "departments": [
    { "name": "Human Resources" },
    { "name": "Sales" },
    { "name": "Field Operations" }
  ],
  "admin": {
    "fullName": "Priya Shah",
    "email": "priya.shah@acme.example"
  }
}
```

- `company.name`, `company.subdomain`, `company.primaryContact.name`,
  `company.primaryContact.email`, `admin.fullName`, `admin.email` are required.
- `company.industry`, `company.primaryContact.phone` are optional.
- `departments` is optional. Omitted → the platform's default department templates are seeded
  1:1 (research.md §5). Provided → creates exactly the submitted list instead (the caller is
  responsible for having already applied any renames/adds/removes client-side during the wizard —
  see spec User Story 3).

## Response `201`

```json
{
  "success": true,
  "data": {
    "tenant": {
      "id": "uuid",
      "name": "Acme Corp",
      "subdomain": "acme",
      "status": "trial"
    },
    "departments": [
      { "id": "uuid", "name": "Human Resources" },
      { "id": "uuid", "name": "Sales" },
      { "id": "uuid", "name": "Field Operations" }
    ],
    "admin": {
      "id": "uuid",
      "fullName": "Priya Shah",
      "email": "priya.shah@acme.example",
      "roleAssigned": "HR/L&D Admin"
    }
  }
}
```

## Error responses

**`400`** — missing/invalid required field(s):
```json
{ "success": false, "message": "company.name is required" }
```

**`403`** — caller is authenticated but not Super Admin, or lacks `provision_tenant`:
```json
{ "success": false, "message": "Forbidden" }
```

**`409`** — subdomain already taken (spec Edge Cases; unique-violation on `tenants.subdomain`,
research.md §2):
```json
{ "success": false, "message": "Subdomain already in use" }
```

**`409`** — duplicate department name within the submitted list (unique-violation on
`departments (tenant_id, name)`):
```json
{ "success": false, "message": "Duplicate department name" }
```

**`500`** — the required `hr_admin` role template is missing from the platform catalog (spec FR-014;
this indicates Spec 1's seed data is missing or corrupted, not a caller error):
```json
{ "success": false, "message": "Provisioning is misconfigured: required admin role template not found" }
```

For every error response above, the whole transaction is rolled back — no `tenants`, `departments`,
`users`, `roles`, or `user_roles` row from the failed attempt exists afterward (FR-013).

## Error shape

Uses the shared `ApiResponse<T>` shape already defined in `packages/types/src/index.ts` — no new
shared type is needed for this contract.
