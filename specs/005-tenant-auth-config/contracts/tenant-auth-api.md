# Contract: Tenant Authentication API

Fastify JSON endpoints under `apps/api/src/tenant-auth/`. **Every** endpoint below takes `subdomain`
as a **query parameter** (`?subdomain=acmecorp`) — never a body field, even for `POST` requests
(research.md §4 addendum): the `tenant-user-context` plugin that resolves `request.user` runs as a
global `onRequest` hook, mirroring `tenant-context.ts`/`super-admin-context.ts`'s existing pattern —
and Fastify's `onRequest` phase runs *before* the request body is parsed, so a body-only field would
be unreadable at the point this plugin needs it. Query strings, by contrast, are available
immediately. Fastify always independently re-resolves `subdomain` via Spec 4's
`resolveTenantBySubdomain` before doing anything else; a mismatched or reserved/unclaimed subdomain
is rejected the same way Spec 4 already rejects it elsewhere. None of these routes trust `subdomain`
as a `tenant_id` shortcut.

## `POST /tenant-auth/login?subdomain=acmecorp`

Public. Request body:
```json
{ "email": "jo@acme.example", "password": "..." }
```

Verifies credentials (real password or, if `must_change_password` is set, the still-valid OTP —
same code path, research.md §6). On success, sets the `tm_tenant_session` cookie (`HttpOnly`,
`Secure` outside development, `SameSite=Strict`, `Path=/`, no `Domain` — host-only, research.md
Constraints) and returns:

```json
{ "success": true, "data": { "id": "uuid", "email": "...", "mustChangePassword": true } }
```

`mustChangePassword: true` tells the frontend to redirect straight to `/set-password` — the session
is real (so the set-password action itself works) but every *other* protected route rejects it
(`require-tenant-user-session.ts`).

**401** — identical generic message whether the email doesn't exist, the tenant doesn't have that
email, or the password/OTP is wrong (FR-009). **429** — rate-limited (FR-010), same shape as Spec
3's `/platform/login`.

## `POST /tenant-auth/set-password?subdomain=acmecorp`

Requires a valid session (guarded by `require-tenant-user-session`, but specifically *allowed*
while `must_change_password` is true — the one exception to that gate).

Request body: `{ "newPassword": "..." }`. On success: hashes and stores the new password, clears
`must_change_password` and `otp_expires_at`, invalidates the OTP (FR-013a, US5 Acceptance Scenario
4). Returns `204`.

## `GET /tenant-auth/me?subdomain=acmecorp`

Requires a valid session (any state, including `must_change_password: true`, so the frontend can
render the right redirect). Returns `{ success: true, data: { id, email, mustChangePassword } }`.

## `POST /tenant-auth/logout?subdomain=acmecorp`

Requires a valid session (allowed even while `mustChangePassword` is true — no reason to trap a
user in a session they can't exit). Revokes it, clears the cookie. `204`.

## `POST /tenant-auth/forgot-password?subdomain=acmecorp`

Public. Request body: `{ "email": "..." }`. Always returns an identical `200` regardless of whether
the email has an account at that tenant (FR-015) — issues a reset token and emails it only if an
account actually exists, silently otherwise.

## `POST /tenant-auth/reset-password?subdomain=acmecorp`

Public. Request body: `{ "token": "...", "newPassword": "..." }`. Rejects an already-used or
expired token (FR-014). On success, sets the new password (does **not** touch
`must_change_password` — this is the forgotten-password path, unrelated to OTP bootstrap).

## `GET /tenant-auth/settings/methods?subdomain=acmecorp`

Requires a valid session **and** the `manage_authentication_settings` permission. Returns the
tenant's currently enabled methods:
```json
{ "success": true, "data": { "methods": ["email_password", "microsoft"] } }
```

## `PUT /tenant-auth/settings/methods?subdomain=acmecorp`

Requires a valid session **and** `manage_authentication_settings`. Request body:
```json
{ "methods": ["microsoft", "email_password"] }
```
Replaces the tenant's enabled-methods set. Rejects (`409`) a request that would leave zero methods
enabled (FR-006).

## `POST /tenant-auth/team?subdomain=acmecorp`

Requires a valid session **and** the `manage_team_members` permission. Request body:
```json
{ "fullName": "...", "email": "...", "roleId": "uuid" }
```
Creates the user immediately with a freshly generated OTP (FR-018), sends the OTP email, returns
`201`. Rejects (`409`) an email already in use **at the same tenant** (FR-020); allows it at a
different tenant.

## Explicitly not part of this contract

- No endpoint here performs real OAuth for Microsoft/Google Workspace/Zoho — marking a method
  "configured" (via the settings endpoints above) is purely configuration data, per spec FR-016.
- `app.tenant_id` for actual tenant-scoped data queries is never set from anything in this contract
  directly — only from the verified session, via the unchanged `tenant-context.ts` plugin.
