# Research: Tenant Authentication Configuration

Grounded in the actual shipped code (`apps/api/src/`, `apps/web/`), not just prior specs' plans —
same discipline as Specs 2–4's planning.

## 1. Extend `users`, reuse Spec 3's password/session helpers directly — no new competing modules

**Decision**: `apps/api/src/db/schema/users.ts` gets new columns
(`password_hash`, `must_change_password`, `otp_expires_at`, `failed_login_count`, `locked_until`) —
exactly what Spec 2's own research anticipated ("Spec 3 is expected to extend this same `users`
table with auth-specific columns... not create a competing table"). `apps/api/src/tenant-auth/`
imports `hashPassword`, `verifyPassword`, `DUMMY_PASSWORD_HASH` from
`platform-auth/password.ts` and `generateSessionToken`, `hashSessionToken`, `sessionExpiryFromNow`
from `platform-auth/session.ts` directly — both files are already fully generic (no Super
Admin-specific logic in either), confirmed by reading them. Only `cookies.ts` needs a new,
tenant-specific file (`tenant-auth/cookies.ts`), since the cookie *name* and *Path* differ, but it
reuses `platform-auth/cookies.ts`'s generic `parseCookie` function rather than duplicating it.

**Rationale**: Constitution Principle XII — don't duplicate already-generic, already-tested logic.
Moving these files to a shared, non-"platform-auth"-named location was considered and rejected as
an unnecessary refactor of working code outside this spec's actual scope; a cross-module import is
normal and idiomatic within one package.

**Alternatives considered**: Copy/fork the password and session helpers into `tenant-auth/` —
rejected, pure duplication with no behavioral difference needed. A single unified "auth" module
covering both Super Admin and tenant-user auth — rejected; the two remain deliberately separate
mechanisms (different tables, different cookies, different session-validation paths), matching
Spec 3's own explicit design goal of keeping Super Admin auth architecturally independent of
tenant-scoped code.

## 2. Auth method configuration is a multi-row table, not a single enum column

**Decision**: `tenant_auth_methods` (`id`, `tenant_id`, `method`, `enabled_at`) — one row per
*enabled* method, `UNIQUE (tenant_id, method)`, `method` constrained via `CHECK` to `'email_password'
| 'microsoft' | 'google_workspace' | 'zoho'` (same idiom as `tenants.status`'s `CHECK`, Spec 2).
Standard `tenant_isolation` RLS policy (`tenant_id = current_setting('app.tenant_id', true)::uuid`)
— identical shape to every other tenant-scoped table.

**Rationale**: Spec FR-002 requires supporting more than one method enabled simultaneously — a
multi-row table represents this naturally (0, 1, or N rows), where a single enum column on `tenants`
could only ever represent one active choice. Enabling a method is `INSERT`; disabling is `DELETE`;
"at least one enabled" (FR-006) is enforced at the application layer inside the settings-update
transaction (count remaining rows before allowing a delete), not by a table constraint — Postgres
has no clean way to express "at least one row per `tenant_id`" as a `CHECK` constraint.

**Alternatives considered**: A single `tenants.auth_methods` array/JSON column — rejected; harder to
enforce per-value integrity (the four-value `CHECK` constraint idiom this codebase already uses
throughout doesn't apply cleanly to array elements), and mixes tenant *identity* data with
authentication *configuration* on the same row for no benefit.

## 3. Session validation resolves tenant_id from the subdomain first — no narrow RLS allowance needed

**Decision**: Unlike Spec 4's subdomain→tenant lookup (which had to search *across all tenants* by
subdomain before any `tenant_id` was known, requiring a new narrow `SELECT`-only RLS policy),
`user_sessions` validation always happens in a context where `tenant_id` has *already* been
independently resolved from the subdomain via Spec 4's `resolveTenantBySubdomain` — every Next.js
page/API call this feature makes explicitly threads the subdomain through (Technical Context
Constraints) before Fastify ever queries `user_sessions`. So the session lookup is: set
`app.tenant_id` to the *already-resolved* value, then `SELECT ... FROM user_sessions WHERE
token_hash = $1` — the *standard* `tenant_isolation` RLS policy (no new policy needed) makes a
session issued for a different tenant structurally invisible. This is also how Spec 4 FR-012
("reject a session presented at a different tenant's subdomain") is satisfied for free — a
mismatched session simply returns zero rows, not a special-cased comparison.

**Rationale**: The narrow-allowance-policy pattern Spec 4 needed only exists because that lookup
had no `tenant_id` at all to filter on. Every other query in this feature has one, resolved
independently and *first* — so no analogous new RLS policy is needed anywhere in this spec. This is
the same reasoning `password_reset_tokens` follows too (§5).

**Alternatives considered**: A narrow allowance policy for `user_sessions` mirroring Spec 4's
`tenant_subdomain_lookup` — rejected once it became clear the tenant_id is always already known
before this table is queried; adding an unnecessary narrow-bypass policy would be a wider security
surface than the standard policy this design actually needs.

## 4. Subdomain is always passed explicitly by the client — never inferred from a proxied Host header

**Decision**: Every browser call this feature's Next.js pages make to Fastify (via a new
`/tenant-api/*` rewrite prefix in `next.config.ts`, mirroring `/platform-api/*`'s existing,
proven-in-this-codebase pattern for keeping the session cookie same-origin) includes the tenant
subdomain explicitly, always as a **query parameter** (`?subdomain=acmecorp`) — never a body field,
even for `POST` requests (addendum below) — sourced from the `x-tenant-subdomain` request header
Spec 4's middleware already sets (read via `next/headers` in the Server Component wrapping each
page, then passed as a prop to the Client Component that makes the actual fetch call).

**Rationale**: Whether a config-level `next.config.ts` rewrite to an external origin reliably
forwards a *custom* header set earlier by `middleware.ts` is not something to rely on implicitly for
a security-relevant value — it's unverified, proxy-implementation-dependent behavior. Explicitly
threading the subdomain through application code (the same value Spec 4's own `/tenant` placeholder
page already successfully read via `headers()`) is unambiguous and testable, and costs only a little
prop-drilling. Fastify never trusts this value as `tenant_id` directly regardless — it always
re-resolves via `resolveTenantBySubdomain` first (Spec 4 FR-004/FR-010), so there is no security
downside to it arriving as an explicit field versus an implicit header.

**Addendum (query param, not body, for every method)**: `tenant-user-context.ts` (§3) must run as a
global `onRequest` hook to match `tenant-context.ts`/`super-admin-context.ts`'s existing pattern —
but Fastify's `onRequest` phase runs *before* the request body is parsed, so a `POST` body field
would be unreadable at the point this hook needs it. Query strings are parsed and available
immediately, regardless of method, so `subdomain` is carried as a query parameter everywhere,
including on every `POST` endpoint (contracts/tenant-auth-api.md).

**Alternatives considered**: Relying on `x-forwarded-host`/implicit header forwarding through the
rewrite proxy — rejected as unverified and unnecessary when an explicit, already-proven-reliable
alternative exists. A dedicated Next.js Route Handler per endpoint (fully explicit server-to-server
`fetch`, no config-level rewrite at all) — considered as more obviously correct but more
boilerplate than reusing the existing declarative `rewrites()` mechanism with an explicit body/query
field; not needed once the subdomain is passed explicitly anyway.

## 5. Password reset tokens follow the same "resolve tenant first" pattern as sessions

**Decision**: `password_reset_tokens` (`id`, `tenant_id`, `user_id`, `token_hash`, `created_at`,
`expires_at`, `used_at`) — standard `tenant_isolation` RLS policy, no narrow allowance. The
"forgot password" request and the "reset password" completion both happen at the tenant's own
subdomain, so `tenant_id` is independently resolved from that subdomain (§4) before either table
read/write — same reasoning as `user_sessions` (§3).

**Rationale**: Consistency — one resolved-tenant-first pattern used everywhere in this feature,
rather than a special case for tokens.

## 6. One-time passwords reuse the password-hashing path exactly; expiry is a separate column

**Decision**: A one-time password (OTP) is generated via `crypto.randomBytes` (a short,
URL-safe-encoded string), then hashed with the *same* `hashPassword` function used for a real
password and stored in the *same* `users.password_hash` column — login verification (`verifyPassword`)
has zero special-casing for "is this an OTP or a real password." `must_change_password = true` and
`otp_expires_at` (set alongside the OTP) are the only OTP-specific state; login checks
`otp_expires_at` only when `must_change_password` is true (a real, already-changed password has no
expiry). Setting a real password clears `must_change_password` and `otp_expires_at` together in the
same update.

**Rationale**: Reusing the exact same verification code path (rather than a parallel "OTP check")
means rate-limiting, timing-equalization, and lockout (spec FR-010) apply to OTP-based login
attempts automatically, with no separate logic to keep in sync. `otp_expires_at` exists because an
OTP, unlike a real password, should not remain valid indefinitely if never used (spec Edge Cases:
"a fresh one-time password" can be re-triggered) — a real password has no equivalent expiry
requirement.

**Alternatives considered**: A separate `one_time_passwords` table (mirroring
`password_reset_tokens`'s shape) — rejected; unlike a reset token (which authorizes a *separate*
action without going through normal login), an OTP's whole purpose is to work through the *normal*
login form and code path (spec Clarifications), so storing it as a real, if temporary, credential in
`password_hash` is the more faithful design, not a workaround.

## 7. Permission model: two new permissions, backfilled onto every existing tenant's HR Admin role

**Decision**: Two new permissions — `manage_authentication_settings`, `manage_team_members` —
seeded and granted to the `hr_admin` role template (for all future provisioning) *and* retroactively
granted to every existing tenant's already-live `hr_admin`-sourced `roles` row, mirroring
`0014_seed_provision_tenant_permission.sql`'s precedent of backfilling an already-live row rather
than only affecting future provisioning.

**Rationale**: Tenants provisioned before this migration (including manually-created test tenants
from Spec 4's own verification) would otherwise have an HR Admin who can't reach this feature's
settings screens at all — a correctness gap, not just a cosmetic one, since FR-004/FR-018 are core
requirements for every tenant, not just newly provisioned ones.

## 8. Settings UI lives under `/settings`, never `/admin`

**Decision**: `apps/web/app/settings/authentication/page.tsx` and
`apps/web/app/settings/team/page.tsx` — confirmed against Spec 4's middleware
(`apps/web/middleware.ts`), which blocks `/platform`, `/admin`, `/provisioning` as root-domain-only
path prefixes on any tenant subdomain (spec FR-005 requires exactly this check).

**Rationale**: Spec FR-005 states this explicitly; `/settings` doesn't collide with any existing
root-domain-only prefix, confirmed by reading `middleware.ts`'s `ROOT_ONLY_PATH_PREFIXES` constant
directly.

## 9. SMTP via `nodemailer` — confirmed with the user, not decided unilaterally

**Decision**: `nodemailer`, configured against an existing SMTP mailbox the user already controls
(credentials supplied via environment variables at implementation time) — not a transactional email
API (Resend/SendGrid/Postmark/SES/Mailgun). Confirmed directly with the user (2026-07-04) via an
explicit question, per constitution Principle XIII.

**Rationale**: No new external service account is needed if existing SMTP credentials are reused;
`nodemailer` is the standard, actively-maintained Node SMTP client with no reasonable built-in
alternative (§ New Dependencies in plan.md).

**Alternatives considered**: A transactional email API — offered as the recommended default in the
sign-off question, explicitly declined in favor of SMTP reuse.

## 10. Design system: flagged as a candidate to lock now, not decided here

**Decision**: This spec's login page is called out by the spec itself as a design priority. Per
Principle V's own process (design decisions are delegated to the UI-UX-Pro-Max skill, then locked),
this plan flags — but does not itself decide — that this could be the point at which the system
gets formally locked, to be confirmed at implementation kickoff.

**Rationale**: Matches the posture Specs 3–4 already established for their own new UI surfaces;
deciding this unilaterally in a plan document would preempt the process Principle V actually
describes.
