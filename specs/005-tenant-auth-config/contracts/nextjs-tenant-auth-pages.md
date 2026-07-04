# Contract: Next.js Tenant Auth Pages

Extends `apps/web/middleware.ts` (Spec 4) — no change to its routing *rules*, only to what the
`/tenant` destination renders (spec Assumptions).

## Configuration

| Env var | Where read | Notes |
|---|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | `apps/api/src/tenant-auth/mailer.ts` (new) | Supplied at implementation time (research.md §9) — never committed. |

`next.config.ts` gains one new rewrite entry, alongside the existing `/platform-api/*` one:
```ts
{ source: "/tenant-api/:path*", destination: `${API_ORIGIN}/:path*` }
```

## `apps/web/app/tenant/page.tsx` (amended)

Server Component. Reads `x-tenant-subdomain` (set by `middleware.ts`, unchanged mechanism) and the
`tm_tenant_session` cookie (via `next/headers`' `cookies()` — httpOnly, readable server-side only).

- **No valid session**: calls Spec 4's (amended) `GET {API_ORIGIN}/tenant-routing/resolve` to get
  `enabledAuthMethods`, and renders the login UI — only the method(s) actually enabled (spec FR-007,
  US3). Passes the resolved `subdomain` down as a prop to the Client Component form(s), which
  include it explicitly in their `/tenant-api/*` calls (research.md §4).
- **Valid session, `mustChangePassword: true`**: redirects to `/set-password`.
- **Valid session, `mustChangePassword: false`**: renders a minimal authenticated confirmation
  (mirrors Spec 3's `/platform` pattern) — no full product dashboard, out of scope (spec
  Assumptions).

## `apps/web/app/forgot-password/page.tsx` (new)

Same subdomain-threading pattern — reads `x-tenant-subdomain`, renders a form that
`POST`s to `/tenant-api/forgot-password?subdomain=...` (query parameter, contracts/tenant-auth-api.md).
Always shows the same generic "if that email exists, check your inbox" confirmation (FR-015).

## `apps/web/app/reset-password/page.tsx` (new)

Reads a `token` query param (from the emailed link) plus the subdomain (same pattern), posts to
`/tenant-api/reset-password`.

## `apps/web/app/set-password/page.tsx` (new)

Requires an active session (any `mustChangePassword` state) — if none, redirects to `/tenant`.
Submits to `/tenant-auth/set-password`; on success, redirects to `/tenant` (now
`mustChangePassword: false`).

## `apps/web/app/settings/authentication/page.tsx` (new)

Requires an active session with `manage_authentication_settings` — if missing, `403` from the
backend surfaces as an in-page message, not a route-level redirect (mirrors how
`apps/web/app/admin/permissions/page.tsx` handles this today). Toggles the four methods; `PUT`s the
full set to `/tenant-api/settings/methods`. Client-side prevents submitting a state with zero
methods, matching the backend's own rejection (FR-006) as a first line of defense, not the only one.

## `apps/web/app/settings/team/page.tsx` (new)

Requires `manage_team_members`. A form (name, email, role) that `POST`s to `/tenant-api/team` — no
pending-invitation list, resend, or revoke UI (spec Assumptions, deliberately minimal).

## Explicitly not part of this contract

- Real SSO sign-in flows (Microsoft/Google Workspace/Zoho buttons render a stubbed, clearly
  non-functional state per spec FR-016 — no OAuth redirect, no callback route).
- A general "tenant settings" hub beyond the two pages this feature needs (spec Assumptions).
- Custom domains per tenant, unchanged from Spec 4's own Out of Scope.
