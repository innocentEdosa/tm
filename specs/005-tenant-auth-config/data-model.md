# Data Model: Tenant Authentication Configuration

## `users` — existing table (Spec 2), amended

New columns only — additive, no existing column changed.

| Column | Type | Notes |
|---|---|---|
| `password_hash` | `text`, nullable | `<saltHex>:<keyHex>` scrypt encoding (reused from `platform-auth/password.ts`). Null only in the instant between account creation and OTP generation (practically never observable — both happen in the same transaction). |
| `must_change_password` | `boolean`, not null, default `false` | `true` from OTP issuance (FR-013) until the user sets their own password (FR-013a). Gates access to everything except the set-password action (`require-tenant-user-session.ts`). |
| `otp_expires_at` | `timestamptz`, nullable | Set whenever an OTP is (re)issued; checked only when `must_change_password` is true. Null once a real password is set. |
| `failed_login_count` | `integer`, not null, default `0` | Rate-limiting state (FR-010), same idiom as `super_admins.failed_login_count` (Spec 3). Reset to `0` on any successful login. |
| `locked_until` | `timestamptz`, nullable | Set once `failed_login_count` reaches the threshold; login refused (even with a correct password) while `now() < locked_until`. |

**Isolation**: Unchanged — the existing `tenant_isolation` policy on `users` (Spec 2/4) already
covers these new columns; no new policy needed.

## `tenant_auth_methods` — new, tenant-scoped

Which of the four supported login methods are enabled for a tenant (spec FR-001, FR-002).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid`, not null, FK → `tenants.id` | |
| `method` | `text`, not null | `CHECK (method IN ('email_password','microsoft','google_workspace','zoho'))` |
| `enabled_at` | `timestamptz`, not null, default `now()` | |

**Constraints**: `UNIQUE (tenant_id, method)` — a method is either enabled (one row) or not
(no row); enabling twice is a no-op, not a duplicate.

**Isolation**: Standard `tenant_isolation` RLS policy (`tenant_id = current_setting('app.tenant_id',
true)::uuid`), identical shape to `roles`/`departments`/`users`.

**Application-enforced rule**: FR-006 ("at least one enabled method") — enforced inside the
settings-update transaction (count remaining rows before permitting a `DELETE`), not a table
constraint (research.md §2).

## `user_sessions` — new, tenant-scoped

A tenant user's server-verified login session (spec Key Entities: Tenant User Session).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid`, not null, FK → `tenants.id` | |
| `user_id` | `uuid`, not null, FK → `users.id` | |
| `token_hash` | `text`, not null, unique | `sha256` hex digest, reusing `platform-auth/session.ts`'s `hashSessionToken` — raw token never stored. |
| `created_at` | `timestamptz`, not null, default `now()` | |
| `expires_at` | `timestamptz`, not null | |
| `revoked_at` | `timestamptz`, nullable | Set on logout. |

**Isolation**: Standard `tenant_isolation` RLS policy — no narrow allowance needed (research.md §3).
`tenant_id` is always set to the value independently resolved from the subdomain *before* this
table is queried, so a session row from a different tenant is structurally invisible (this is also
how spec FR-012 is satisfied).

## `password_reset_tokens` — new, tenant-scoped

A forgotten-password reset token (spec Key Entities: Password Reset Token) — a separate mechanism
from the One-Time Password below (research.md §5-6).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid`, not null, FK → `tenants.id` | |
| `user_id` | `uuid`, not null, FK → `users.id` | |
| `token_hash` | `text`, not null, unique | Same hashing idiom as session tokens. |
| `created_at` | `timestamptz`, not null, default `now()` | |
| `expires_at` | `timestamptz`, not null | |
| `used_at` | `timestamptz`, nullable | Set once the token is consumed; a used or expired token is rejected (FR-014). |

**Isolation**: Standard `tenant_isolation` RLS policy — same "resolve tenant first" reasoning as
`user_sessions` (research.md §5).

## One-Time Password — not a table (research.md §6)

Represented entirely by existing `users` columns: `password_hash` (holds the OTP's hash, exactly
like a real password), `must_change_password` (`true`), `otp_expires_at` (set alongside issuance).
No separate entity or table — login verification has no OTP-specific code path, only a
post-authentication gate.

## Reused, unchanged entities

- **Tenant** (Spec 2): consulted for `id`, `subdomain`, `status` — no new columns.
- **Role / User-Role Assignment** (Spec 1): `manage_authentication_settings` and
  `manage_team_members` (new permissions, research.md §7) are granted to the `hr_admin` role
  template and backfilled onto every existing tenant's `hr_admin`-sourced role — no schema change to
  `roles`/`role_permissions`/`user_roles` themselves.

## Request-scoped values (not persisted)

| Value | Set by | Carried as | Consumed by |
|---|---|---|---|
| Subdomain (explicit) | Next.js Server Component, from Spec 4's `x-tenant-subdomain` header | Body field (`POST`) or query param (`GET`) on every `/tenant-api/*` call | `apps/api/src/tenant-auth/*` routes — always independently re-resolved via `resolveTenantBySubdomain`, never trusted directly (research.md §4) |
| `app.tenant_id` | **Unchanged** — `apps/api/src/plugins/tenant-context.ts`, from `request.user.tenantId` | Postgres session variable | Every tenant-scoped table's RLS policy, including this feature's three new tables |
| `request.user` | **New** — `apps/api/src/tenant-auth/tenant-user-context.ts`, from a verified `user_sessions` row | In-process request decoration | `tenant-context.ts` (unchanged, existing) and `requirePermission` (Spec 1, unchanged) |
