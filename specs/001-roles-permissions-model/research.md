# Research: Roles & Permissions Model

All Technical Context items were resolvable from the user-supplied tech context, the existing
codebase (`apps/api`), and the constitution. No item required an open research spike; each decision
below states what was chosen and why, including the tradeoffs the user should be aware of.

## 1. ORM and driver: Drizzle over the existing `pg` connection

**Decision**: Use `drizzle-orm` (specifically `drizzle-orm/node-postgres`) bound to the *same*
`pg.Pool` instance that `@fastify/postgres` already creates and decorates onto `fastify.pg.pool` —
do not create a second pool or add a second Postgres client library.

**Rationale**: `apps/api` already depends on `@fastify/postgres`, which has `pg` as a peer dependency;
`pg@8.22.0` is already resolved in the workspace. Drizzle's `node-postgres` adapter accepts any
`pg.Pool`, so reusing `fastify.pg.pool` gives Drizzle's type-safe query builder and migration tooling
without opening a second connection pool to Neon — important given Neon's per-tier connection limits
(see §5). This is also the most dependency-minimal path available (Constitution Principle XII): the
only genuinely new packages are `drizzle-orm` (runtime) and `drizzle-kit` (dev-only, for migration
generation).

**Alternatives considered**:
- `@neondatabase/serverless` (HTTP/WebSocket driver) — rejected per the user's explicit instruction:
  this is a long-running Fastify server, not an edge runtime, so the HTTP driver's per-query connection
  model would add latency and complexity with no benefit over a normal pooled `pg` connection.
- `postgres` (postgres.js) as the driver — rejected: it would duplicate what `pg` (already present)
  provides, adding a second Postgres client library for no functional gain.
- Hand-written raw SQL via `@fastify/postgres` directly, no ORM — rejected: the spec's tenant-scoped
  RLS model, the platform-catalog/tenant-role split, and the migration/seeding interface (FR-005)
  benefit from Drizzle's schema-as-code and generated migrations across the six tables this feature
  introduces (`permissions`, `role_templates`, `role_template_permissions`, `roles`, `role_permissions`,
  `user_roles`); hand-rolled SQL migrations would work but lose type safety across `apps/api` and any
  future consumers of `packages/types`.

## 2. Tenant context propagation: `SET LOCAL` inside a per-request transaction

**Decision**: Every request that touches a tenant-scoped table runs inside a single Postgres
transaction (`BEGIN` → `SET LOCAL app.tenant_id = $1` → route logic → `COMMIT`/`ROLLBACK`), using a
dedicated client checked out from the pool for the lifetime of the request. The tenant id used in
`SET LOCAL` comes only from the server-verified session (never from a client-supplied header, body
field, or query param).

**Rationale**: `SET LOCAL` (as opposed to plain `SET`) scopes the setting to the current transaction
and automatically clears it on `COMMIT`/`ROLLBACK`. This matters specifically because the app uses a
*pooled* connection: a pooled `pg.Pool` hands the same physical connection to different requests over
time, and a plain `SET` would leak the previous request's tenant id into the next request that happens
to reuse that connection. `SET LOCAL` inside an explicit transaction closes that leak entirely — this
directly implements constitution Principle I ("no cross-tenant data access... under any circumstance").

**Alternatives considered**:
- Setting tenant id via a connection-level `SET` right after checkout, without a transaction — rejected:
  still requires manual reset before the connection returns to the pool, and one forgotten code path
  (e.g., an early return or thrown error) leaks tenant context to the next borrower. The transaction
  form fails safe: a thrown error rolls back and the setting is gone regardless.
- Passing `tenant_id` as an explicit `WHERE` clause on every query, no RLS — rejected: this depends on
  every present and future query author remembering to add the filter; RLS makes the database itself
  the enforcement point, matching Principle I's "validated server-side... application code MUST NOT
  assume single-tenant context."

## 3. Fastify enforcement pattern: request-scoped transaction plugin + `preHandler` permission check

**Decision**: A small internal Fastify plugin (no new dependency — built from `fastify-plugin`, which
is already a transitive dependency of `@fastify/postgres`) that:
1. On every request (`onRequest` hook), reads the authenticated session's tenant id and user id
   (session/auth mechanism itself is a dependency of a future auth spec — for this feature it is
   assumed to already decorate `request.user = { id, tenantId }`, never trusting client-sent values).
2. Checks out a client from `fastify.pg.pool`, opens a transaction, runs `SET LOCAL app.tenant_id`,
   and decorates `request.tenantDb` with a Drizzle instance bound to that client.
3. On `onResponse`/`onError`, commits or rolls back and releases the client.

A `fastify.requirePermission(permissionKey)` decorator returns a `preHandler` function that queries
(through `request.tenantDb`, so RLS is already active) whether the user's assigned role(s) grant the
given permission key, replying `403` if not. Routes opt in via
`{ preHandler: [fastify.requirePermission("approve_enrollment")] }`.

**Rationale**: Keeps enforcement composable and impossible to bypass by forgetting a manual check in
a route body — the transaction (and therefore RLS) is established before any handler code runs, and
the permission check is a declarative route option rather than an ad hoc `if` statement duplicated
per route.

**Alternatives considered**:
- Per-route manual permission checks inside handler bodies — rejected: easy to forget on a new route,
  which is exactly the failure mode Principle I is meant to prevent.
- A single global `onRequest` hook that checks permissions for all routes generically by inferring the
  required permission from the route path — rejected: too implicit/magic for a security-critical path;
  explicit per-route declaration is easier to audit.

## 4. Migration/seeding interface for tenant provisioning

**Decision**: Expose a single function, `seedDefaultRolesForTenant(tenantDb, tenantId)`, in a shared
module (`apps/api/src/permissions/`) that the future tenant-provisioning feature calls once, inside
the new tenant's own transaction (with `app.tenant_id` already set to that tenant). It copies every
`role_templates` row (and its `role_template_permissions`) into that tenant's own `roles` and
`role_permissions` rows. The Super Admin role template is deliberately excluded from this copy — it is
seeded exactly once, platform-wide, by a one-time migration, not per tenant.

**Rationale**: Satisfies the spec's requirement to "expose the interface... that [the provisioning]
spec will call" without building provisioning itself. Because the function runs inside the *tenant's*
own transaction (not a superuser context), the normal RLS `WITH CHECK` policy on `roles`/
`role_permissions` applies to the inserts it performs — provisioning gets no special bypass, which
keeps the isolation model uniform.

**Alternatives considered**:
- A database trigger that auto-copies templates whenever a new tenant row is inserted — rejected:
  hides a significant side effect inside the database layer, making it harder to reason about and test
  in application code; an explicit function call is more auditable and matches Principle IV
  (ambiguity resolved in the spec/plan, not invented implicitly).

## 5. Connection pooling for Neon + Fastify

**Decision**: Use Neon's **pooled** connection string (the `-pooler` hostname variant, PgBouncer-based,
transaction-pooling mode) as `DATABASE_URL` in every non-local environment, and keep the `pg.Pool` max
size conservative (proposed: `max: 10` per Fastify instance/dyno) rather than Node/Postgres defaults.
Local development continues to use the existing `docker-compose.yml` Postgres 16 container directly
(no pooler needed at that scale).

**Rationale**: Neon's lower tiers cap total concurrent Postgres connections (including from its own
pooler) well below what an unbounded `pg.Pool` could open under load. Because this feature's enforcement
pattern (§3) holds one dedicated client per in-flight request for the request's full duration
(transaction-scoped `SET LOCAL`), pool size directly caps concurrent in-flight requests per server
process — this is a real tradeoff to flag, not a hidden detail: under sustained concurrency above the
pool size, requests queue for a client rather than failing outright. `max: 10` is a starting point
intended to be tuned from observed pool-wait-time metrics once the app has real traffic, not a final
number.

**Alternatives considered**:
- Neon's direct (unpooled) connection string — rejected: a long-running Fastify server holding a
  `pg.Pool` of direct connections would compete with the connection ceiling much faster than going
  through Neon's own pooler.
- A very large `pg.Pool` max (e.g., 50+) — rejected without load data: on Neon's lower tiers this risks
  exhausting the account-wide connection limit shared across all app instances; starting conservative
  and raising it based on measured contention is the safer default.

## 6. Test runner for permission-check and RLS-correctness coverage

**Decision (approved by user sign-off, 2026-07-01)**: Use **Vitest** for both the pure-logic unit tests
(permission-union resolution) and the integration tests that exercise a real Postgres connection (RLS
policies, `SET LOCAL` behavior, cross-tenant denial).

**Rationale**: `apps/api`'s `package.json` currently has no test runner installed at all. Node's
built-in `node:test` was proposed first as the zero-new-dependency option per Principle XII, but the
user explicitly chose Vitest instead when asked to sign off (Principle XIII) — its watch mode and
snapshot support are worth the one new dev dependency for a security-critical path that will be run and
re-run frequently during implementation. `vitest` is added as a **dev dependency only** of `apps/api`
(and `apps/web` if/when its tests are added later) — it ships no runtime code to production.

**Alternatives considered**:
- Node's built-in `node:test` + `node:assert` — zero new dependencies, sufficient for unit and
  DB-integration-style tests; rejected in favor of Vitest per explicit user preference, not a technical
  shortcoming.
- No dedicated integration tests, unit tests only — rejected: the spec explicitly requires proof that
  cross-tenant access is blocked, not assumed (SC-003, SC-004); this cannot be verified without a real
  Postgres connection exercising the actual RLS policies.
