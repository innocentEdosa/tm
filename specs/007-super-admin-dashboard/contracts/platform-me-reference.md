# Contract Reference: `GET /platform/me` (unchanged)

Documented originally in the Super Admin Authentication spec. This feature makes **no amendment** —
included here only as a reference for the new `lib/platform-session.ts` helper's consumer contract,
following the same documentation precedent as the tenant-side shell.

## `GET /platform/me`

Requires a valid `tm_super_admin_session` cookie. Response (unchanged):

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "admin@tm.example",
    "name": "Jo Admin",
    "lastLoginAt": "2026-07-04T12:00:00.000Z",
    "isSuperAdminFlagSet": true
  }
}
```

## New consumer: `apps/web/lib/platform-session.ts`

Not a new HTTP endpoint — a Server Component helper, mirroring `lib/tenant-session.ts`'s role
(research.md §2). Reads the `tm_super_admin_session` cookie server-side and re-resolves it against
`/platform/me`, server-to-server.

- On no session / invalid session: the consuming layout redirects to `/platform/login`.
- On a valid session: the helper returns `{ authenticated: true, id, email, name, lastLoginAt }` for
  the shell to render.

No `subdomain` parameter exists on this helper (unlike the tenant one) — the platform shell operates
strictly at the root domain, never a tenant subdomain (FR-007).
