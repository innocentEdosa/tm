# Phase 0 Research: Tenant Management

## §1. Modeling Archive and Pending-Deletion states

**Decision**: Add two independent nullable-timestamp columns to the existing `tenants` table —
`archivedAt` and `deletionRequestedAt` (plus `deletionPurgeAt`, computed at delete-time as
`deletionRequestedAt + grace period`) — rather than expanding the existing `status` CHECK constraint
(`trial`/`active`/`suspended`/`cancelled`) to include `archived`/`pending_deletion` values.

**Rationale**: The Add/Edit Team Member spec (013) already shipped this exact pattern for `users`:
`users.archivedAt`, NULL = active, a reversible "full soft-delete" checked at login-time and on every
request via `tenant-user-context.ts`. Mirroring it for `tenants` means Downgrade (User Story 4) can
keep operating purely on `status` (Active → Trial) without needing to special-case "what if the tenant
is also archived" inside the status transition logic — that's instead handled by FR-012 as a precondition
check ("editing or downgrading an archived tenant requires reactivation first"), which reads more clearly
as two orthogonal checks than one five-value status enum would.

**Alternatives considered**: Extending the `status` CHECK to `trial|active|suspended|cancelled|archived|
pending_deletion` was considered. Rejected because it would force every future status-transition rule
(including Downgrade's "one step down" logic) to explicitly enumerate which of the two new values does
or doesn't participate, whereas separate columns compose independently by construction — archiving a
Trial tenant and archiving an Active tenant both just set the same column, with no interaction with
`status` at all.

## §2. Reusing Tenant Provisioning Core's subdomain validation

**Decision**: `edit-tenant.ts`'s subdomain-change path calls the same validation Tenant Provisioning
Core's `provision-tenant.ts` already exports for uniqueness (`SubdomainTakenError`) and the reserved-word
list (`ReservedSubdomainError`) — imported directly, not reimplemented.

**Rationale**: Spec FR-006 explicitly requires this, and Tenant Provisioning Core's own `provisioning-
routes.ts` already demonstrates the exact error-to-HTTP-status mapping (`409` for both) this feature's
route handler should reuse verbatim.

**Alternatives considered**: A second, independent subdomain-validation function scoped to edits only
was considered and rejected — the constitution's Comprehensive-Version/no-drift posture (and this spec's
own FR-006 wording) rules out two independently-maintained checks for the same invariant.

## §3. Session termination: why both a gate check and an active revoke

**Decision**: On archive or delete, the route handler (a) executes, via `request.superAdminDb`,
`UPDATE user_sessions SET revoked_at = now() WHERE tenant_id = $1 AND revoked_at IS NULL` inside the same
transaction that sets `archivedAt`/`deletionRequestedAt` on the `tenants` row (this requires the new
Super Admin RLS allowance on `user_sessions` described in §8 — without it, this UPDATE would silently
match zero rows under `tenant_isolation` alone), and (b) `tenant-user-context.ts` is extended to
also deny (leave `request.user` unset) when the resolved tenant's `archivedAt` or `deletionRequestedAt` is
non-null — the same short-circuit shape it already uses for `users.archivedAt`.

**Rationale**: The spec's Clarifications resolved "immediate termination" (not "denied on next request")
for archive/delete. In a stateless HTTP session model there's no way to interrupt a request already
in-flight at the instant the action is taken, so "immediate" is implemented as the strongest available
guarantee: the very next request from any of that tenant's sessions is rejected (gate check, covering
requests that arrive after the revoke), and the underlying session record is actively invalidated in the
same transaction as the state change (bulk revoke, covering the case where a different part of the system
later re-checks `revoked_at` directly rather than going through the gate). Implementing only the gate
check would technically satisfy "the account stops working," but would leave `user_sessions` rows for an
archived/deleted tenant showing as live (`revoked_at IS NULL`), which is misleading for any future
session-auditing or -listing feature and inconsistent with how a Super Admin's own session is revoked on
logout (`platform-auth-routes.ts`, `.set({ revokedAt: new Date() })`).

**Alternatives considered**: Bulk-revoke only (no gate check) was considered and rejected — a session
created between the revoke query running and the transaction committing (a genuine race, however narrow)
would otherwise briefly validate against a tenant that's already archived. The gate check closes that
gap for free, since it re-reads the tenant's live state on every request regardless of session-row state.

## §4. Downgrade semantics

**Decision**: Downgrade is a single-step `status` transition (Active → Trial), applied via a fixed lookup
table, not a generic "move status down" function. Attempting to downgrade a tenant already at `trial`
(the lowest of the two states Downgrade operates over) returns a clear rejection rather than silently
no-op'ing.

**Rationale**: Directly reflects the spec Clarifications' resolution — no plan/tier concept, status field
only — and Tenant Provisioning Core FR-012's existing deferral of plan-tier data to a future spec. Scoping
Downgrade to exactly one transition (Active → Trial) rather than a general N-step status machine avoids
building unused generality: `Suspended`/`Cancelled` are not reachable through any code path this spec (or
Tenant Provisioning Core) defines, so a "downgrade one step" function would have no defined behavior for
them anyway.

**Alternatives considered**: A general status-lattice "downgrade" function covering all four `status`
values was considered and rejected as speculative — Suspended/Cancelled transition logic remains
explicitly out of scope (Tenant Provisioning Core's own Constitution Alignment: "N/A... explicitly does
not implement Active/Suspended/Cancelled transition logic"), so building downgrade paths for states with
no other entry/exit logic yet would be unused generality with nothing to test it against.

## §5. Permanent purge after the deletion grace period

**Decision**: A standalone script, `apps/api/scripts/purge-deleted-tenants.ts`, run via `tsx` — selects
every tenant with `deletion_purge_at <= now()`, and for each, permanently deletes the tenant row and all
tenant-scoped data (cascading via existing FK `ON DELETE` behavior where already defined, explicit
per-table deletes where not) inside one transaction per tenant. Invocation (cron schedule, Railway Cron
Job, or manual) is a deployment/ops concern outside this feature's code, exactly like the existing
`seed:super-admin` script's own invocation.

**Rationale**: No scheduled-job runner (`node-cron` or similar) is installed anywhere in this codebase
today (verified: no `cron`/`scheduled`/`setInterval` hits in `apps/api/src`). Adding one would be a new
dependency requiring the Principle XIII sign-off this plan doesn't have, for a problem the existing
standalone-script idiom already solves — `seed-super-admin.ts` is `tsx`-invoked exactly this way, safe to
re-run, and already the established pattern for "an operational script that isn't part of the live
request path."

**Alternatives considered**: An in-process `setInterval` inside the Fastify server was considered and
rejected — it would tie the grace-period purge to the API process's uptime (a restart resets the timer,
and a purge running mid-request-handling adds unrelated load to the user-facing process) for no benefit
over an externally-scheduled script invocation, which is also easier to observe and rerun independently
in Railway's own logs.

## §6. `tenant_action_log`: RLS posture

**Decision**: `tenant_action_log` has no RLS policy and is never queried through `request.tenantDb` — it
is a platform-level table (`super_admin_id`, `tenant_id`, `action`, `created_at`) in the same shape as the
already-shipped `super_admin_sessions` table, granted `INSERT`/`SELECT` only to `tm_app` (no `UPDATE`/
`DELETE` — an append-only log).

**Rationale**: FR-016 requires logging but explicitly defers the audit-log *UI* to a future spec; the only
code path that ever writes or reads this table in this feature is Super-Admin-only route handlers, which
already run outside `request.tenantDb`'s per-tenant transaction (same posture `provisioning-routes.ts`
uses for the `tenants` table itself). RLS scoped to `app.tenant_id` would be actively wrong here — a
Super Admin needs to see log entries across every tenant, not one.

**Alternatives considered**: Scoping `tenant_action_log` per-tenant with RLS (so a future tenant-facing
"who changed my account" view could reuse it) was considered and rejected as speculative — no such
tenant-facing feature exists or is requested, and Principle I's isolation requirement applies to
tenant-scoped data, not to a platform-operator's own audit trail of platform-level actions.

## §7. Frontend: list + row-action pattern

**Decision**: `apps/web/app/(platform-shell)/tenants/page.tsx` (server component, session-derived
capability check) + `tenants-client.tsx` (client component: table, row actions, confirmation dialogs) —
the same two-file split already used by `(dashboard-shell)/settings/team/page.tsx` +
`team-settings-client.tsx`, using the same `@tm/ui` primitives (`Button`, `Input`, `Card`, `Badge`,
`PageHeader`, `Pagination`, `Drawer`) already proven against the locked design system.

**Rationale**: This is the only established list-view-with-row-actions pattern in the codebase; reusing
it directly satisfies Principle V (build against the locked design system, no ad hoc component style) at
zero extra design cost, and reuses `Pagination`'s existing `PAGE_SIZE = 25` convention rather than
inventing a new one.

**Alternatives considered**: None seriously — this is the only precedent of this shape in the codebase,
and the constitution's Principle V leaves no room for a competing pattern absent an explicit
design-system update.

## §3a. Subdomain routing must also treat archived/pending-deletion as unreachable

**Decision**: `tenant-routing/resolve-tenant.ts` (Domain-Based Tenant Routing spec) is amended to
check `archived_at`/`deletion_requested_at` before its existing `status` switch, returning `state:
"suspended"` for either — reusing the existing `suspended` routing state rather than adding two new
ones.

**Rationale**: FR-015 requires a deleted tenant to be "unreachable via its subdomain," and FR-007
requires an archived tenant's users to have no access at all — but `resolveTenantBySubdomain`'s
`status` switch only ever sees `trial`/`active`/`suspended`/`cancelled`, and archived/pending-deletion
are orthogonal columns (data-model.md `tenants`), invisible to that switch entirely. Without this
change, an archived Trial tenant would still resolve as `state: "valid"` to `apps/web/middleware.ts`,
even though `tenant-user-context.ts` (research.md §3) already blocks its users from actually logging
in — a confusing, silently-inconsistent gap between "routing says reachable" and "auth says blocked."

**Alternatives considered**: Adding two new `TenantRoutingState` values (`"archived"`,
`"pending_deletion"`) was considered and rejected as unused precision for this feature — nothing in
`apps/web/middleware.ts` or `tenant-routing-routes.ts`'s HTTP contract currently branches on
`suspended` vs. a hypothetical new state differently, so reusing `suspended` (already meaning
"recognized tenant, not currently usable") satisfies both FRs without widening a public contract this
spec doesn't otherwise touch.

## §8. Super Admin RLS allowance on `tenants` and `user_sessions` (blocking gap found during planning)

**Decision**: Add a `super_admin_full_access` permissive RLS policy to `tenants`
(`USING (current_setting('app.is_super_admin', true) = 'true') WITH CHECK (same)`), and the same policy
to `user_sessions`, mirroring the exact dual-policy shape already shipped for `form_fields` (Custom
Fields Framework spec, migration `0028_rls_custom_fields.sql`). Every route this feature adds queries
`tenants` and `user_sessions` through `request.superAdminDb` (the Drizzle handle
`super-admin-context.ts` already decorates every Super-Admin-session request with, transaction-scoped,
`app.is_super_admin` already set) — never `fastify.pg.pool` directly, and never `request.tenantDb`.

**Rationale**: This is a real, currently-existing gap, not a hypothetical — `tenants`' own RLS migration
(`0009_rls_tenants.sql`) states outright: "this means tm_app can never enumerate other tenants — a future
platform-wide 'list all tenants' console needs its own narrow ... read path ... not a change to
[`tenant_isolation`]." Tenant Provisioning Core's `provisioning-routes.ts` never hit this gap because
provisioning *creates* a tenant (and sets `app.tenant_id` to the new row's own id before inserting it,
satisfying `tenant_isolation`'s `WITH CHECK` directly) — it never needs to *read* a different tenant's
row. This feature is the first to need exactly that: reading and writing arbitrary existing tenants from
a connection with no single `app.tenant_id` set. `user_sessions` has the identical gap for the bulk
session-revoke step (research.md §3) — its only policy today is the standard `tenant_isolation` keyed on
`app.tenant_id`, which a Super-Admin-context connection never sets.

Reusing the `form_fields` dual-policy shape (rather than inventing a new one) means: `tenant_isolation`
is left completely unedited on both tables (no regression risk to any existing tenant-scoped code path),
and the new policy is additive and narrowly scoped to exactly the already-proven `app.is_super_admin`
allowance clause — the same mechanism `platform-auth-routes.ts` already uses today, just not yet
referenced by these two tables' policies.

**Alternatives considered**: A `BYPASSRLS`-role read path (`tm_platform_reader`, the mechanism the Super
Admin Authentication spec's own Clarifications explicitly superseded) was considered and rejected — the
constitution and that spec both already settled on the `app.is_super_admin` allowance-clause pattern
specifically to avoid a second, harder-to-audit privileged role; reopening that decision here would
contradict a settled cross-spec precedent rather than extend it.

**Follow-on fix, found during implementation**: adding `super_admin_full_access` as a *second*
permissive policy on `tenants`/`user_sessions` — alongside their existing `tenant_isolation` policy —
reproduces a gotcha `tenant-routing/resolve-tenant.ts` already had to solve once for
`tenant_subdomain_lookup`: Postgres evaluates every OR'd permissive policy's qual for a table, not just
the one that ends up granting access. On a pooled connection previously used for a tenant-scoped
request, `app.tenant_id` can be left "registered" (its now-ended `SET LOCAL` means
`current_setting('app.tenant_id', true)` returns `''`, not `NULL`, for the rest of that physical
backend's life) — and `tenant_isolation`'s own clause casts that to `uuid`, which throws and poisons
the *entire* query, including the unrelated `super_admin_full_access` clause that would otherwise have
granted access cleanly. Fixed the same way `resolve-tenant.ts` fixed it for its own query: pin
`app.tenant_id` to the nil UUID defensively in `super-admin-context.ts`, once, for every Super-Admin
request — rather than re-solving this per table each time a new `super_admin_full_access` policy is
added.

## §9. New dependencies

**Decision**: None.

**Rationale**: Every piece of infrastructure this feature needs (Fastify routing, Drizzle schema/
migrations, `requireSuperAdminSession`, the `users.archivedAt`/`user_sessions.revoked_at` idioms, the
`tsx`-run standalone-script idiom, `@tm/ui` components, Vitest) is already installed and used identically
by at least one prior shipped spec in this repo.
