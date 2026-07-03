# Research: Super Admin Authentication

Grounded in the actual shipped code (`apps/api/src/`), not just prior specs' plans — same discipline
as Spec 2's planning.

## 1. No new dependencies — password hashing, cookies, and rate limiting are all built-in territory

**Decision**: Zero new packages. Password hashing uses Node's built-in `crypto.scrypt` (a KDF Node's
own docs recommend for exactly this purpose — not "rolling your own crypto," using a peer-reviewed
algorithm via a standard-library binding). Session cookies are read/written with a ~20-line hand-rolled
helper (parse `Cookie` header, build `Set-Cookie` string) rather than `@fastify/cookie`. Rate-limit
state (failed-attempt count, lockout expiry) lives as plain columns on `super_admins`, queried through
Drizzle — no `@fastify/rate-limit` or in-memory limiter (which wouldn't be correct across multiple
server processes/restarts anyway; a DB-backed counter is the *more* correct choice here, not just the
dependency-avoiding one). Session tokens are generated with `crypto.randomBytes`.

**Rationale**: Constitution Principle XII requires checking built-ins before reaching for a package.
Every piece this spec needs is either a documented Node built-in or a narrow, well-bounded parsing
task (a single self-generated, hex-encoded cookie value — not arbitrary third-party cookie headers
with quoting/escaping edge cases, which is what makes general-purpose cookie libraries earn their
keep). None of this rises to the complexity where a library meaningfully reduces risk over the
built-in/hand-rolled approach.

**Alternatives considered**: `bcrypt`/`argon2` for hashing — both fine algorithms, but `node:crypto`
scrypt avoids a native-binding dependency (bcrypt) or a newer, less battle-tested-in-this-ecosystem
package (argon2) for a project that has taken pains to avoid new dependencies twice already.
`@fastify/cookie` — the official first-party plugin, genuinely good, but general-purpose cookie
parsing (multiple cookies, `Path`/`Domain` matching across many routes, complex value encoding) is
overkill for one self-generated token value on one route family. `@fastify/rate-limit` — in-memory by
default, which is wrong for a multi-process deployment; the DB-backed columns are simpler and correct
by construction.

## 2. Session model: server-side, revocable, hashed-at-rest

**Decision**: `super_admin_sessions` stores a **hash** of the session token (`sha256`, hex), never the
raw token — mirroring how `super_admins.password_hash` never stores a plaintext password. The raw
token lives only in the httpOnly cookie sent to the browser. Login: generate `crypto.randomBytes(32)`,
hex-encode it as the raw token, store `sha256(token)` in `super_admin_sessions.token_hash`. Every
subsequent request: hash the incoming cookie value the same way and look up by `token_hash`.

**Rationale**: If `super_admin_sessions` were ever read by anyone with DB access (an admin, a backup,
a future bug), a stored raw token is immediately usable to hijack that session; a stored hash is not
(same threat model as never storing plaintext passwords). Confirmed via Clarifications: sessions are
server-side and revocable specifically so a compromised session can be ended immediately (FR-011) —
hashing at rest is the same-cost, same-pattern hardening applied to the token itself.

## 3. Cookie: name, scope, attributes

**Decision**: Cookie name `tm_super_admin_session`, distinct from any name a future tenant-user session
mechanism would use (reserving that namespace is a documented expectation for whichever future spec
builds tenant-user auth — research.md §5). Attributes: `HttpOnly` (never readable by JS — FR-006's
session token must not be exposed to any client-side code path that could leak it), `Secure` (sent
only over HTTPS — modern browsers already treat `localhost` as a secure context, so this is safe to
set unconditionally with no `NODE_ENV` branching), `SameSite=Strict`, `Path=/`.

**Revised, 2026-07-03 (three corrections in sequence, all caught by manual browser/`curl`
verification — none by the automated test suite, since Fastify's `.inject()` doesn't model real
cookie `Path`/`SameSite`/third-party-cookie enforcement at all)**:

1. **`Path`** was originally `/platform`, matching Clarifications' "path-scoped cookies" isolation
   argument at spec time. Once `GET /admin/permissions`, `GET /admin/role-templates`, and
   `POST /provisioning/tenants` (Spec 1 and Spec 2's routes) were migrated onto
   `requireSuperAdminSession`, it started guarding three separate path prefixes (`/platform/*`,
   `/admin/*`, `/provisioning/*`) with no common ancestor narrower than `/` — a `Path=/platform`
   cookie would silently never reach the other two. Fixed to `Path=/`.
2. **`SameSite`** was originally `Strict`, which silently broke every follow-up request once
   exercised through the real two-origin browser flow (`apps/web`/`apps/api` are different origins,
   locally and in production) — `Strict`/`Lax` both withhold cookies on cross-site fetch/XHR
   requests. Tried `SameSite=None; Secure` next, the textbook-correct value for a genuinely
   cross-site cookie — but this *still* failed: Chrome (default rollout as of this writing, and the
   direction every major browser is heading) treats `SameSite=None` cookies set by a different
   registrable domain than the top-level page as third-party cookies and blocks them outright,
   regardless of `SameSite`. No cookie attribute fixes this — it needed an architectural change.
3. **Same-origin proxy** (the actual fix): `apps/web/next.config.ts` now proxies browser requests to
   apps/api through apps/web's own origin (`rewrites()`: `/platform-api/* → API_ORIGIN/*`). The
   browser now only ever talks to one origin — apps/web's — so the cookie is never cross-site at
   all, and `SameSite=Strict` (the most restrictive, most secure option) works correctly and is
   what's actually set. All four client pages that previously fetched
   `${NEXT_PUBLIC_API_URL}/...` (`apps/web/app/platform/login/page.tsx`, `apps/web/app/platform/
   page.tsx`, `apps/web/app/admin/permissions/page.tsx`, `apps/web/app/provisioning/new/page.tsx`)
   now fetch the relative `/platform-api/...` path instead. `NEXT_PUBLIC_API_URL` (client-exposed)
   was replaced by `API_ORIGIN` (server-only, read by the rewrite, never shipped to the browser).

## 4. How FR-007 (mutual session-type rejection) actually holds, by construction

**Decision**: Tenant-scoped sessions and Super Admin sessions are read from **different cookies by
different code paths** — `request.user` (tenant-scoped, currently the dev-only header stub in
`server.ts`, per research.md of Spec 1) is never touched by the new `super-admin-context` plugin, and
`request.superAdmin` (this spec) is never touched by tenant-scoped code. A Super Admin route's guard
(`requireSuperAdminSession`) only ever looks for the `tm_super_admin_session` cookie; a tenant-scoped
route's guard only ever looks at `request.user`. There is no shared parsing/validation step where one
token type could be misread as the other.

**Rationale**: This satisfies FR-007 as an architectural property, not a runtime check that has to
remember to reject the "wrong" type — there is no code path where a `tm_super_admin_session` cookie
value could ever populate `request.user`, or vice versa, because nothing ever tries to interpret one
as the other. Tests (tasks.md) still assert this explicitly (presenting each session type where the
other is expected and confirming rejection), since "true by construction" is exactly the kind of claim
that needs a regression test to keep it true after future changes.

## 5. What FR-012/FR-013 (the RLS allowance-clause pattern) does and does not require of this spec

**Decision**: This spec's own tables (`super_admins`, `super_admin_sessions`) have no `tenant_id` and
thus no RLS policy at all — the allowance-clause pattern doesn't apply to them. This spec does **not**
modify any existing tenant-scoped table's RLS policy (`tenants`, `departments`, `users`, `roles`,
`role_permissions`, `user_roles` all keep their Spec 1/2 policies unchanged) — per the spec's own
FR-013, applying the clause to a specific table is "the responsibility of whichever spec introduces or
already owns that table." What this spec *does* build: the server-side mechanism that sets
`app.is_super_admin` per request (the `super-admin-context` plugin, research.md §6), and one concrete,
minimal demonstration that the mechanism works — `GET /platform/me` reads back
`current_setting('app.is_super_admin', true)` inside the same transaction the plugin opened, proving
the flag is actually set correctly for a real authenticated request (contracts/platform-auth-api.md).

**Rationale**: Keeps this spec's scope matched to what it actually owns (identity + session
mechanism), while still leaving a concrete, testable proof that the pattern works — not just a
documented convention nobody has run.

## 6. The `super-admin-context` Fastify plugin mirrors `tenant-context.ts` exactly

**Decision**: `apps/api/src/platform-auth/super-admin-context.ts` follows the identical
request-scoped-transaction idiom as `apps/api/src/plugins/tenant-context.ts` (Spec 1): on every
request, check for a valid Super Admin session; if found, acquire a dedicated client from
`fastify.pg.pool`, `BEGIN`, `SELECT set_config('app.is_super_admin', 'true', true)`, decorate
`request.superAdminDb`; commit/release on `onResponse`, rollback/release on `onError`. `app.tenant_id`
is simply never set on this transaction — the allowance-clause pattern's `OR` makes that fine (a
future tenant-scoped table's policy evaluates the second branch and doesn't need the first to be
non-null).

**Rationale**: Reusing an already-proven idiom (rather than inventing a second pattern for "the other
kind of session") keeps the codebase's mental model of "how does a request get a scoped Drizzle
handle" consistent, and keeps this plugin trivially reviewable against its existing sibling.

## 7. Super Admin creation is HTTP-unreachable by construction, not just by convention

**Decision**: The `tm_app` Postgres role (the running server's connection) is granted `SELECT`,
`UPDATE` on `super_admins` — deliberately **no `INSERT`**. The only code path that can create a
`super_admins` row is the seed script (`apps/api/scripts/seed-super-admin.ts`), which connects with
`DATABASE_URL` (the migration/owner role), run manually by an operator, never by the running server.

**Rationale**: FR-014 already requires the seed script be "not a UI, not a network-reachable endpoint"
— granting `tm_app` no `INSERT` privilege on this table turns that requirement into a database-level
guarantee (a future bug that accidentally exposed an insert path would still fail at the grant level),
the same defense-in-depth spirit as Spec 1's `0001_lock_catalog_grants.sql` REVOKEs on the permission
catalog.

## 8. Seed script input and idempotency

**Decision**: `apps/api/scripts/seed-super-admin.ts` accepts `SUPER_ADMIN_EMAIL`/
`SUPER_ADMIN_PASSWORD` environment variables (for scripted/CI-driven deploys); if either is unset, it
falls back to an interactive prompt via Node's built-in `node:readline/promises` (no new dependency).
Before inserting, it runs `SELECT count(*) FROM super_admins`; if the count is greater than zero, it
prints a message and exits without inserting, unless `ALLOW_ADDITIONAL_SUPER_ADMIN=true` is set, in
which case it proceeds to insert an additional account (FR-015).

**Rationale**: Directly matches the spec's own stated requirement (prompt or env vars; safe to re-run
without duplicates; explicit override to add another). Environment-variable support additionally
covers the deploy-automation case Principle-XI's "Railway" target implies, without requiring an
interactive TTY.

## 9. Failed-login handling and account enumeration

**Decision**: On an unknown email, the response is byte-for-byte identical (status code and body) to a
known email with a wrong password — both return a generic `401 {"success": false, "message":
"Invalid email or password"}`. As a cheap, standard hardening (not a hard spec requirement — SC-003 is
about response *content*, not timing), a wrong-password check and an unknown-email check both perform
one `scrypt` verification each (verifying the submitted password against a fixed dummy hash when the
email isn't found), so the two cases take comparable time — avoiding an obvious timing side-channel at
negligible cost. Rate-limiting (FR-009) only accrues against **known** emails (there's no row to
attach a failed-attempt counter to for an email that doesn't exist) — an attacker probing many
nonexistent emails has nothing to "lock," which is expected and does not weaken FR-008/SC-003's
content-based guarantee. A rate-limited response ("too many attempts, try again in N minutes") is
intentionally a *different* message from the wrong-password/unknown-email case — this mirrors how
virtually every production login system (not just this one) treats "you're locked out" as an honest,
distinct signal, which does not itself reveal whether the account exists any more than the existence
of the login form does.

## 10. Testing

**Decision**: Vitest, matching Spec 1/2's convention — real local Postgres, no mocks, since RLS/
grant-level guarantees (research.md §7's "no INSERT for tm_app") and session-hash lookups can't be
verified as "actually enforced" against a mock.
