# Research: Domain-Based Tenant Routing

Grounded in the actual shipped code (`apps/api/src/`, `apps/web/`), not just prior specs' plans — same
discipline as Specs 2–3's planning.

## 1. Reserved-subdomain list: a shared TypeScript constant, not a database table

**Decision**: `RESERVED_SUBDOMAINS` is a single `readonly string[]` constant defined once in
`apps/api/src/tenant-routing/reserved-subdomains.ts`, imported by both the new tenant-routing lookup
module (this spec) and `apps/api/src/provisioning/provision-tenant.ts` (Spec 2, FR-016).

**Rationale**: The list is fixed platform-wide, not tenant data, and changes to it are code changes
reviewed like any other (spec Assumptions) — a database table would add a migration, a seed step, and
its own RLS/grant reasoning for something that is, in substance, a static list checked in application
code. A shared TS constant is the simplest thing that satisfies "one canonical list, never two that
can drift" (spec FR-005, Constitution Principle VIII).

**Alternatives considered**: A `reserved_subdomains` table — rejected as unnecessary ceremony for
static, code-reviewed data with no per-tenant dimension. A duplicated literal array in both
`provision-tenant.ts` and the new lookup module — rejected explicitly, since that's exactly the
"two lists that can drift" failure mode Spec 2's amendment (FR-016) was written to avoid.

## 2. Authorizing the pre-auth subdomain→tenant lookup under RLS: an additive, `SELECT`-only permissive policy

**Decision**: `apps/api/drizzle/0009_rls_tenants.sql` already enables RLS on `tenants` with:

```sql
CREATE POLICY "tenant_isolation" ON "tenants"
  USING (id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (id = current_setting('app.tenant_id', true)::uuid);
```

This restricts a connection to its own tenant row — which the subdomain lookup can't satisfy, because
it doesn't know `tenant_id` yet (that's what it's trying to find, by searching across all tenants by
`subdomain`). A new migration adds a **second, `SELECT`-only permissive policy**:

```sql
CREATE POLICY "tenant_subdomain_lookup" ON "tenants"
  FOR SELECT
  USING (current_setting('app.subdomain_lookup', true) = 'true');
```

(A plain text comparison, not `::boolean` — see the implementation-time addendum at the end of this
section for why.)

Postgres OR's multiple permissive policies together for a given command — so a row is readable if
*either* `tenant_isolation`'s condition holds *or* this new policy's flag is set. Because the new
policy is declared `FOR SELECT` only, `WITH CHECK` (governing `INSERT`/`UPDATE`) remains solely
`tenant_isolation`'s — this cannot be used to write or forge a tenant row. The flag is set only inside
a dedicated function (`resolveTenantBySubdomain`, `apps/api/src/tenant-routing/resolve-tenant.ts`)
that opens its own short-lived transaction, sets the flag itself (never from client input), selects
only `id` and `status` (never contact info), then commits/releases — mirroring the exact idiom
`apps/api/src/platform-auth/super-admin-context.ts` uses for `app.is_super_admin`.

**Rationale**: `0009_rls_tenants.sql`'s own comment anticipates this exact gap and suggests "a future
platform-wide 'list all tenants' console needs its own narrow `BYPASSRLS` read path." That suggestion
predates Spec 3's explicit supersession of `BYPASSRLS` (`tm_platform_reader`) in favor of an
explicit-allowance-clause pattern (`app.is_super_admin`) — this spec follows that established,
newer precedent instead, for the same reason Spec 3 gave: a `BYPASSRLS` role is an all-or-nothing
escape hatch, invisible in the policy definitions themselves, whereas an additive permissive policy is
reviewable, narrowly scoped to one command type, and independently droppable without touching
`0009_rls_tenants.sql` (a migration Specs 2 and 3 already depend on).

**Alternatives considered**: A `BYPASSRLS` role for this lookup — rejected, exactly the anti-pattern
Spec 3 retired. Editing `tenant_isolation` itself to add an `OR` clause — rejected because it would
apply the new condition to `INSERT`/`UPDATE`/`DELETE` too (not just `SELECT`), widening the blast
radius of a change meant to be narrow, and because it edits a migration two other specs depend on
rather than adding a new one. Querying via a raw `postgres` superuser connection bypassing RLS
entirely — rejected as a bespoke one-off with no policy trail at all, worse than either alternative
above for auditability.

**Implementation-time addendum (discovered writing `tenant-routing-rls-policy-mechanism.test.ts`)**:
The originally-planned qual used `current_setting('app.subdomain_lookup', true)::boolean IS TRUE`.
Empirically, once a custom GUC has been referenced *at all* on a physical Postgres backend — even by
a `SET LOCAL` whose transaction has since ended — `current_setting(name, true)` returns `''` (not
`NULL`) for the rest of that backend's life, not "unrecognized configuration parameter." Casting `''`
to `boolean` throws, and because connections here are drawn from the same pool
`tenant-context.ts` also uses, a later ordinary tenant-scoped request on a recycled connection that
never touches `app.subdomain_lookup` would otherwise intermittently break on this policy's clause
(reproduced directly via `psql` — order of the `OR`'d clauses does not help; Postgres constant-folds
the erroring subexpression during planning, before any row-level short-circuit evaluation applies).
Fixed two ways, both inside this feature's own new code, with no change to `tenant_isolation`: (1)
the policy's qual is a plain text comparison (`= 'true'`), which is simply `false` for `NULL` or `''`
rather than throwing; (2) `resolveTenantBySubdomain` additionally pins `app.tenant_id` to the nil UUID
(`00000000-0000-0000-0000-000000000000`) rather than leaving it genuinely unset, so
`tenant_isolation`'s own `::uuid` cast (on the other side of the same `OR`) always has valid syntax to
evaluate too.

## 3. Reserved words are checked before any database query

**Decision**: `resolveTenantBySubdomain` checks the incoming (lowercased) label against
`RESERVED_SUBDOMAINS` first and returns `reserved` immediately if it matches — no `SELECT` is ever
issued for a reserved word (spec FR-006), regardless of what (if anything) exists in `tenants`.

**Rationale**: Directly satisfies FR-006's "MUST NOT perform a tenant lookup" wording, and is cheaper
than a database round-trip for the common case of a well-known reserved label.

## 4. Only the raw subdomain string crosses the Next.js→Fastify boundary — never a tenant_id

**Decision**: `apps/web/middleware.ts` extracts the candidate subdomain label from the Host header and
sends only that string to Fastify's `GET /tenant-routing/resolve?subdomain=<label>` — Fastify's
response carries a routing decision (`reserved | not_found | suspended | cancelled | valid`) and, for
`valid`, a display name for the placeholder page — never a `tenant_id`. Downstream, middleware forwards
the same raw subdomain string (never a resolved id) to the rest of the request via an
`x-tenant-subdomain` header.

**Rationale**: Directly satisfies spec FR-004 ("not trusted directly from the hostname string") and
FR-010 ("Fastify MUST NOT treat a value received from Next.js... as authoritative proof of tenant
identity"). If a `tenant_id` were passed across this boundary instead, any code trusting it later would
be trusting a value that originated as an unauthenticated Host header, one hop removed — passing only
the subdomain forces every consumer to independently re-resolve it via the same lookup, with no
shortcut available even if one were tempted to add one later.

## 5. Next.js middleware never queries Postgres directly

**Decision**: All tenant data access for this feature stays in `apps/api`. `apps/web/middleware.ts`'s
only network call is a `fetch` to `apps/api`'s new resolve endpoint.

**Rationale**: Constitution Principle XI fixes the stack as Next.js frontend / Fastify backend;
giving Next.js its own `pg`/Drizzle client would fragment where tenant data access is reasoned about
and duplicate the RLS-authorization logic from research.md §2 in a second place. The resolve endpoint
is called server-to-server (from middleware's server-side execution, not from browser JS), directly
against `API_ORIGIN` — not through `apps/web/next.config.ts`'s `/platform-api/*` browser-facing rewrite
proxy, since that proxy exists specifically to solve the Super Admin session-cookie cross-origin
problem (memory: `super-admin-cookie-cross-origin-gap`), which doesn't apply here — this call carries
no cookie and is never initiated by browser JS.

**Alternatives considered**: Giving Next.js middleware a direct Postgres client — rejected per
Principle XI and to avoid a second RLS-authorization code path. Routing the resolve call through the
`/platform-api/*` proxy — rejected as unnecessary indirection for a server-to-server call that was
never subject to the cross-origin cookie problem the proxy exists to solve.

## 6. Testing split: Vitest for `apps/api`, manual/curl `quickstart.md` for `apps/web` middleware

**Decision**: The reserved-word/not-found/suspended/valid decision logic and the new RLS policy get
full Vitest integration-test coverage in `apps/api/tests/integration/`, matching Specs 1–3's
convention (real Postgres, no mocks — the `app.subdomain_lookup` flag's actual enforcement can't be
verified against a mock). `apps/web/middleware.ts`'s Host-header parsing and rewrite/404 behavior are
verified manually via `quickstart.md`'s scenarios (`curl -H "Host: ..."` and real-browser checks
against `lvh.me`).

**Rationale**: `apps/web` has no test runner configured today (no Vitest, no Playwright — checked: no
`*.test.*` files, no `playwright.config.*` anywhere in the repo). Adding one is a dependency-shaped
decision (Constitution Principle XIII) this feature doesn't need to make: the actual
security-and-correctness-critical logic (reserved words, RLS, status branching) lives entirely in
`apps/api`, which already has the tooling to test it thoroughly. The remaining Next.js-side logic is
a small, low-risk amount of Host-string parsing plus response-driven `NextResponse.rewrite`/404 calls —
adequately covered by manual verification, consistent with how Spec 3's two new Next.js pages were
verified (per that spec's own memory note: "only real browser verification... surfaces" some classes
of bug that `.inject()`-based tests don't).

**Alternatives considered**: Adding Vitest (or Playwright) to `apps/web` for this feature — rejected
for now per Principle XIII (no dependency added without explicit sign-off, and none was sought here);
flagged in plan.md's Technical Context as a future decision if Next.js-side logic grows substantially.

## 7. Root-domain-only path isolation is a prefix check, not a single hardcoded path

**Decision**: Middleware maintains a small list of root-domain-only path prefixes (`/platform`,
`/admin`, `/provisioning` — every existing non-tenant route in `apps/web/app/` today) and returns a
404 for any of them when the resolved Host is a tenant subdomain, not just `/platform/login`
specifically.

**Rationale**: Spec FR-003 says "`/platform/login` and any other root-domain-only paths" — `/admin/
permissions` (Spec 1) and `/provisioning/new` (Spec 2) are exactly that "any other" category today,
and none of them make sense on a tenant subdomain either. Enumerating the existing top-level route
segments is simpler and more obviously complete than trying to invert the (currently very small) set
of tenant-facing paths.

## 8. `app.tenant_id` and this feature's lookup are two structurally separate mechanisms

**Decision (restates spec FR-011/FR-012 for implementation clarity)**: This feature's subdomain
resolution never sets `app.tenant_id`. That session variable continues to be set only by
`apps/api/src/plugins/tenant-context.ts`, sourced only from `request.user.tenantId` after
authentication. The two mechanisms are expected to agree in the common case (a user's session tenant
matches the subdomain they're on) but FR-012 requires an explicit consistency check once tenant-user
authentication exists (not yet built — spec Assumptions) — that check compares `request.user.tenantId`
against a tenant_id independently re-resolved from the `x-tenant-subdomain` header (research.md §4),
never the header trusted directly. This spec establishes the header-forwarding contract; wiring the
actual comparison into request handling is this feature's responsibility to leave ready for, but the
comparison itself can only be *exercised* once a real tenant-user session exists to compare against.
