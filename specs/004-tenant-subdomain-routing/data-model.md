# Data Model: Domain-Based Tenant Routing

This feature adds no new tables and no new columns. It adds one new RLS policy to an existing table
and one new, non-tabular, shared constant.

## `tenants` — existing table (Spec 2), no schema change

Consulted here by `subdomain` and `status` only (`apps/api/src/db/schema/tenants.ts`, unchanged).

| Column consulted | Used for |
|---|---|
| `id` | The `tenant_id` this feature resolves to, for the placeholder landing page and (once tenant-auth exists) the FR-012 consistency check — never exposed to Next.js/the browser directly (research.md §4). |
| `subdomain` | The lookup key (`WHERE lower(subdomain) = lower($1)`, spec Edge Cases: case-insensitive). |
| `status` | Drives the routing decision: `trial`/`active` → `valid`; `suspended` → `suspended`; `cancelled` → `cancelled`. |

**Isolation — amended**: `apps/api/drizzle/0009_rls_tenants.sql`'s `tenant_isolation` policy
(`USING/WITH CHECK id = current_setting('app.tenant_id', true)::uuid`) is unchanged. A new, additive
migration adds a second, `SELECT`-only permissive policy:

```sql
CREATE POLICY "tenant_subdomain_lookup" ON "tenants"
  FOR SELECT
  USING (current_setting('app.subdomain_lookup', true) = 'true');
```

Deliberately a plain text comparison, not `::boolean` — confirmed empirically during implementation
(research.md §2 addendum) that once a custom GUC has been referenced at all on a physical connection,
`current_setting(name, true)` returns `''` (not `NULL`) for the rest of that connection's life, and
`''::boolean` throws; a text comparison never does. `resolveTenantBySubdomain` additionally pins
`app.tenant_id` to the nil UUID (`00000000-0000-0000-0000-000000000000`) rather than leaving it
unset, for the same reason on the `tenant_isolation` side of the `OR`.

Postgres evaluates permissive policies for the same command with `OR` — so `SELECT` succeeds if either
policy's condition holds. `INSERT`/`UPDATE`/`DELETE` remain governed solely by `tenant_isolation`'s
`WITH CHECK` (research.md §2). No grant changes: `tm_app` already has full CRUD on `tenants`
(`0012_lock_department_catalog_grants.sql`).

## Reserved Subdomain List — shared constant, not a table

A fixed, platform-wide `readonly string[]` (`RESERVED_SUBDOMAINS`), defined once in
`apps/api/src/tenant-routing/reserved-subdomains.ts` (research.md §1):

```
www, api, app, admin, mail, ftp, smtp, imap, pop, ns1, ns2, static, cdn, assets, help, support,
status, docs, blog, dev, staging, test, platform, portal, dashboard, login, auth, billing,
security, webmail
```

Consulted by:
- `apps/api/src/tenant-routing/resolve-tenant.ts` (this spec) — checked before any `SELECT` (spec
  FR-006).
- `apps/api/src/provisioning/provision-tenant.ts` (Spec 2, FR-016) — checked before tenant-record
  insert.

Not tenant-scoped, not stored in the database — a code-reviewed, platform-fixed list (spec Key
Entities, Constitution Alignment).

## Routing Decision — a value, not a persisted entity

The output of `resolveTenantBySubdomain(subdomain)` is one of a fixed set of states, computed on every
call from the two sources above — never itself stored:

| State | Meaning | Derived from |
|---|---|---|
| `reserved` | Subdomain label is on `RESERVED_SUBDOMAINS` | Reserved list only — no query issued (FR-006) |
| `not_found` | No tenant row matches, and not reserved | `tenants` lookup returns zero rows |
| `valid` | Tenant exists, `status` is `trial` or `active` | `tenants.status` |
| `suspended` | Tenant exists, `status` is `suspended` | `tenants.status` |
| `cancelled` | Tenant exists, `status` is `cancelled` | `tenants.status` |

`valid` additionally carries the tenant's `name` (for the placeholder landing page's "Welcome to
{name}" text) — never the raw `id` (research.md §4).

## Request-scoped values (not persisted)

| Value | Set by | Carried as | Consumed by |
|---|---|---|---|
| Candidate subdomain label | `apps/web/middleware.ts`, parsed from the `Host` header | `x-tenant-subdomain` request header (raw string only) | Downstream Next.js Server Components (tenant landing page); reserved for the future tenant-auth spec's FR-012 consistency check (research.md §8) |
| `app.subdomain_lookup` | `apps/api/src/tenant-routing/resolve-tenant.ts`, transaction-local (`set_config(..., true)`) | Postgres session variable | The new `tenant_subdomain_lookup` RLS policy only — never read back by application code |
| `app.tenant_id` | **Unchanged** — `apps/api/src/plugins/tenant-context.ts`, from `request.user.tenantId` | Postgres session variable | Existing `tenant_isolation` policy and every tenant-scoped table — this feature does not touch this value or its source |
