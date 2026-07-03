# Contract: Super Admin Authentication Routes

Fastify JSON endpoints under the `/platform` prefix (Clarifications: fixed platform-level path, not a
subdomain), backing all three user stories. None of these routes use `request.tenantDb` or the
tenant-context plugin — they run against `fastify.pg.pool` directly (login/seed-adjacent lookups) or
through `request.superAdminDb` (the Super Admin-scoped transaction from
`apps/api/src/platform-auth/super-admin-context.ts`, research.md §6).

> **2026-07-03**: `requireSuperAdminSession` (used by all three routes below) is now also used to
> guard `GET /admin/permissions`, `GET /admin/role-templates` (Spec 1), and
> `POST /provisioning/tenants` (Spec 2), which previously used a separate, now-retired mechanism
> (`requirePlatformPermission`/`tm_platform_reader`). The session cookie's `Path` was widened from
> `/platform` to `/` to actually reach those other route prefixes, and the browser now reaches all
> of these routes through `apps/web/next.config.ts`'s same-origin rewrite proxy
> (`/platform-api/* → apps/api`), not apps/api's real URL directly (research.md §3).

## `POST /platform/login`

Public (no session required — this *creates* one). Authenticates solely against `super_admins`
(FR-005).

**Request**:
```json
{ "email": "operator@handiwoker.example", "password": "correct horse battery staple" }
```

**Response `200`** (also sets the `tm_super_admin_session` cookie — `HttpOnly`, `Secure`,
`SameSite=Strict`, `Path=/`; research.md §3 — `Strict` works because the browser reaches this route
through apps/web's same-origin rewrite proxy, not apps/api's real URL directly):
```json
{ "success": true, "data": { "id": "uuid", "email": "operator@handiwoker.example", "name": "Jordan Lee" } }
```
The raw session token is never present in the response body — only in the cookie.

**Response `401`** — wrong password, unknown email, **or** invalid request shape. Identical in every
case (FR-008, SC-003):
```json
{ "success": false, "message": "Invalid email or password" }
```

**Response `429`** — the account is currently locked out after repeated failures (FR-009). Distinct
message, does not violate FR-008 (research.md §9):
```json
{ "success": false, "message": "Too many failed attempts. Try again in 12 minutes." }
```

## `POST /platform/logout`

Requires a valid Super Admin session (guarded by `requireSuperAdminSession`, research.md §6). Marks
the current session's `revoked_at` and clears the cookie (`Max-Age=0`).

**Response `204`**: no body.

**Response `401`**: no valid Super Admin session was presented — same rejection path used for any
Super Admin-guarded route (FR-007).

## `GET /platform/me`

Requires a valid Super Admin session. This is FR-016's minimal authenticated landing confirmation, and
also the concrete proof of FR-012/FR-013's mechanism (research.md §5): it reads back
`current_setting('app.is_super_admin', true)` inside `request.superAdminDb`'s transaction and includes
it in the response, proving the indicator is actually set correctly for a real authenticated request —
not just documented as a pattern.

**Response `200`**:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "operator@handiwoker.example",
    "name": "Jordan Lee",
    "lastLoginAt": "2026-07-02T10:15:00.000Z",
    "isSuperAdminFlagSet": true
  }
}
```

**Response `401`**: no valid Super Admin session, or a tenant-scoped session was presented instead
(User Story 2, Acceptance Scenario 2) — rejected outright, never silently treated as a tenant-less
request.

## Error shape

Uses the shared `ApiResponse<T>` shape already defined in `packages/types/src/index.ts` — no new
shared type is needed for this contract.

## Explicitly not part of this contract

No endpoint here creates a `super_admins` row (FR-014's seed script is a standalone CLI tool, not an
HTTP route — see contracts/seed-super-admin-script.md) and no endpoint exposes the tenant directory,
platform analytics, or any other Super Admin Console functionality (explicitly out of scope, spec.md
Out of Scope).
