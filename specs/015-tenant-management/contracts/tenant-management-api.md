# Contracts: Tenant Management routes

Six Fastify JSON endpoints, all registered in `apps/api/src/tenant-management/tenant-management-
routes.ts`, all guarded by `requireSuperAdminSession` (identical guard to the existing
`POST /provisioning/tenants` route), all reading/writing through `request.superAdminDb` (never
`request.tenantDb`, never a direct `fastify.pg.pool` connection — see data-model.md's new
`super_admin_full_access` policies).

Every response uses the shared `ApiResponse<T>` shape from `packages/types/src/index.ts` — no new
shared type is needed.

---

## `GET /tenants`

Backs User Story 1 (FR-001).

### Query params

| Param | Notes |
|---|---|
| `page` | Optional, default `1`. |
| `pageSize` | Optional, default `25` (matches the existing `Pagination`/`team-settings-client.tsx` convention). |

### Response `200`

```json
{
  "success": true,
  "data": {
    "tenants": [
      {
        "id": "uuid",
        "name": "Acme Corp",
        "subdomain": "acme",
        "status": "trial",
        "isArchived": false,
        "isPendingDeletion": false,
        "primaryContactName": "Jordan Lee",
        "primaryContactEmail": "jordan.lee@acme.example",
        "createdAt": "2026-07-01T12:00:00.000Z"
      }
    ],
    "meta": { "page": 1, "pageSize": 25, "total": 1 }
  }
}
```

`isArchived` is `archived_at IS NOT NULL`; `isPendingDeletion` is `deletion_requested_at IS NOT NULL`
(data-model.md). A tenant in either state still appears in this list (with the flag set) — it is not
hidden, since a Super Admin needs to find it again to reactivate/recover it.

---

## `PATCH /tenants/:id`

Backs User Story 2 (FR-005, FR-006). Edits company details; a `subdomain` change re-runs Tenant
Provisioning Core's own validation (research.md §2).

### Request

```json
{
  "name": "Acme Corporation",
  "industry": "Manufacturing",
  "subdomain": "acme-corp",
  "primaryContact": { "name": "Jordan Lee", "email": "jordan.lee@acme.example", "phone": "+1-555-0100" }
}
```

All fields optional — only submitted fields are updated. `subdomain` is validated only if present and
different from the tenant's current value (FR-006 edge case: same-value save is a no-op, not an error).

### Response `200`

```json
{ "success": true, "data": { "id": "uuid", "name": "Acme Corporation", "subdomain": "acme-corp", "status": "trial" } }
```

### Error responses

**`404`** — no tenant with that `id`.
**`409`** — `subdomain` already in use, or reserved (same messages as `POST /provisioning/tenants`):
```json
{ "success": false, "message": "Subdomain already in use" }
```
**`409`** — target tenant is archived or pending deletion (FR-012):
```json
{ "success": false, "message": "Reactivate this tenant before editing it" }
```

---

## `POST /tenants/:id/archive` and `POST /tenants/:id/reactivate`

Backs User Story 3 (FR-007, FR-008, FR-009).

No request body. `archive` sets `archived_at = now()` and bulk-revokes the tenant's `user_sessions`
(research.md §3) in one transaction; already-archived is a no-op `200`, not a `409` (FR-009).
`reactivate` clears `archived_at`; already-active is a no-op `200`.

### Response `200`

```json
{ "success": true, "data": { "id": "uuid", "isArchived": true } }
```

### Error responses

**`404`** — no tenant with that `id`.
**`409`** (reactivate only, defensive) — target tenant is pending deletion: recover it instead.

---

## `POST /tenants/:id/downgrade`

Backs User Story 4 (FR-010, FR-011). Single fixed transition: `active` → `trial`.

No request body.

### Response `200`

```json
{ "success": true, "data": { "id": "uuid", "status": "trial" } }
```

### Error responses

**`404`** — no tenant with that `id`.
**`409`** — tenant is already at `trial` (lowest reachable status for this action) or is archived/pending
deletion:
```json
{ "success": false, "message": "This tenant cannot be downgraded further" }
```

---

## `POST /tenants/:id/delete` and `POST /tenants/:id/recover`

Backs User Story 5 (FR-013–FR-015b).

### `delete` request

```json
{ "confirmTenantName": "Acme Corporation" }
```

`confirmTenantName` MUST exactly match the tenant's current `name` (FR-013's "explicit confirmation step
naming the tenant") — a mismatch is a `400`, not a silent no-op, so the caller gets clear feedback rather
than wondering why nothing happened. On match: sets `deletion_requested_at = now()`,
`deletion_purge_at = now() + <grace period>`, bulk-revokes `user_sessions` (same mechanism as archive,
research.md §3), inside one transaction (FR-015, FR-017).

### `delete` response `200`

```json
{ "success": true, "data": { "id": "uuid", "isPendingDeletion": true, "purgeAt": "2026-08-14T12:00:00.000Z" } }
```

### `delete` error responses

**`400`** — `confirmTenantName` missing or does not match:
```json
{ "success": false, "message": "Confirmation name does not match this tenant" }
```
**`404`** — no tenant with that `id`.

### `recover` request

No body.

### `recover` response `200`

```json
{ "success": true, "data": { "id": "uuid", "isPendingDeletion": false } }
```

### `recover` error responses

**`404`** — no tenant with that `id`, **or** the tenant's grace period has already elapsed and it was
already permanently purged (FR-015b, spec Edge Cases) — same `404` shape as any other not-found; the
caller cannot distinguish "never existed" from "already purged," which is intentional (nothing
tenant-identifying about a purged tenant should be inferable from this response).
**`409`** — tenant is not currently pending deletion (nothing to recover).

---

## Shared error shape

All non-2xx responses use `{ "success": false, "message": string }`, identical to every other route in
this codebase (`packages/types/src/index.ts`'s `ApiResponse<T>`).
