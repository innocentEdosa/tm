# Data Model: Super Admin Authentication

Both tables are platform-global — no `tenant_id` column, no RLS policy, by design (spec FR-001;
Constitution Alignment). This is not an oversight to reconcile with the shared-schema-w/-RLS model;
it's the explicit point of this spec (research.md §5).

## Tables

### `super_admins` — platform-global, no `tenant_id`

The Super Admin account itself (spec FR-001, FR-002).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK, default `gen_random_uuid()` | |
| `email` | `text`, unique, not null | Stored lowercase-normalized; lookup at login also lowercases the input, so case never affects matching. |
| `password_hash` | `text`, not null | `scrypt` output plus its salt, encoded together (research.md §1); never plaintext. |
| `name` | `text`, not null | Display name only — no further profile fields (FR-002 keeps this minimal). |
| `failed_login_count` | `integer`, not null, default `0` | Rate-limiting state (FR-009); reset to `0` on any successful login. |
| `locked_until` | `timestamptz`, nullable | Set when `failed_login_count` reaches the threshold; login is refused (even with correct credentials) while `now() < locked_until`. |
| `created_at` | `timestamptz`, not null, default `now()` | |
| `last_login_at` | `timestamptz`, nullable | Null until first successful login; updated on every successful login. |

**Isolation**: No RLS (no tenant dimension). Locked down at the Postgres grant level instead: `tm_app`
(the running server's role) gets `SELECT`, `UPDATE` only — **no `INSERT`**, so no HTTP-reachable code
path can ever create a row here (research.md §7). Only the seed script, connecting as the
migration/owner role, can insert.

**Validation rules**: `email` matches a standard email shape (enforced at the application layer on
both the seed script and, moot in practice since login never creates rows, nowhere else). Password
strength/complexity rules are not specified by this spec — deferred to whatever minimum length/entropy
check the seed script and any future account-management UI choose to enforce; not a data-model
concern.

---

### `super_admin_sessions` — platform-global, no `tenant_id`

One row per active or past Super Admin login (spec FR-006; Key Entities: Super Admin Session).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK, default `gen_random_uuid()` | |
| `super_admin_id` | `uuid`, not null, FK → `super_admins.id`, `ON DELETE CASCADE` | Deleting a Super Admin (not built by this spec, but the FK holds regardless) removes their sessions too. |
| `token_hash` | `text`, unique, not null | `sha256` hex digest of the raw session token — the raw token itself is never stored (research.md §2). |
| `created_at` | `timestamptz`, not null, default `now()` | |
| `expires_at` | `timestamptz`, not null | Absolute expiry (spec Assumptions: 8 hours from `created_at`, set at creation time — not sliding/renewed on activity). |
| `revoked_at` | `timestamptz`, nullable | Set on logout (FR-011). A session is valid only when `revoked_at IS NULL AND expires_at > now()`. |

**Isolation**: No RLS (no tenant dimension). `tm_app` gets `SELECT`, `INSERT`, `UPDATE` (login creates
a row; every request's lookup reads; logout sets `revoked_at`). No `DELETE` grant — expired/revoked
rows are left in place as an audit trail, not purged by application code (a future retention/cleanup
job, if ever needed, is out of scope here).

## Relationships

```
super_admins  1──* super_admin_sessions   (super_admin_id, ON DELETE CASCADE)
```

No relationship to any tenant-scoped table (`tenants`, `users`, `roles`, etc.) — Super Admins are not
users of any tenant, by design.

## Derived concept: the `app.is_super_admin` session indicator

Not a column — set per-request by the `super-admin-context` Fastify plugin (research.md §6), inside a
dedicated transaction, from a validated `super_admin_sessions` lookup only. Never derived from, or
overridable by, any client-supplied header, cookie value, or request body field (FR-012). This is the
value any future tenant-scoped table's RLS policy references in its Super Admin allowance clause
(FR-013) — e.g. `USING (tenant_id = current_setting('app.tenant_id', true)::uuid OR
current_setting('app.is_super_admin', true) = 'true')`. This spec sets the indicator and proves it
works (`GET /platform/me`, contracts/platform-auth-api.md); it does not itself add this clause to any
existing table's policy (research.md §5).

## State transitions

`super_admin_sessions`: `active` (default, `revoked_at IS NULL AND expires_at > now()`) →
`revoked` (`revoked_at` set, via logout) or `expired` (natural, once `now() >= expires_at`, no column
change needed — the validity check is computed at read time, not a stored status field). Once
`revoked` or `expired`, a session can never become valid again — there is no "reactivate" path.

`super_admins.locked_until`: unset by default → set to `now() + 15 minutes` when
`failed_login_count` reaches 5 → automatically stops applying once `now() >= locked_until` (no
column change needed, same read-time-computed pattern as session expiry) → `failed_login_count` resets
to `0` on the next successful login, whether or not it happened after a lockout window elapsed.
