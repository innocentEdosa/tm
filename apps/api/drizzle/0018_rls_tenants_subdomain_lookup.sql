-- Second, SELECT-only permissive RLS policy on `tenants` (spec 004 FR-015; research.md §2, data-model.md).
-- The existing `tenant_isolation` policy (0009_rls_tenants.sql) restricts a connection to its own
-- tenant row via `app.tenant_id` — but resolving a subdomain to a tenant is inherently a cross-tenant
-- lookup performed *before* any tenant_id is known, so it cannot be satisfied by that policy alone.
-- Postgres evaluates multiple permissive policies for the same command with OR, so SELECT succeeds if
-- EITHER tenant_isolation's condition holds OR this policy's narrow, server-set flag is set. Declared
-- FOR SELECT only, so WITH CHECK (INSERT/UPDATE/DELETE) remains governed solely by tenant_isolation —
-- this policy can never be used to write or forge a tenant row. The flag is set only inside
-- `resolveTenantBySubdomain` (apps/api/src/tenant-routing/resolve-tenant.ts), never from client input
-- — mirrors the explicit-allowance-clause pattern `app.is_super_admin` established (Super Admin
-- Authentication spec), not a BYPASSRLS role. 0009_rls_tenants.sql itself is left completely unedited.
--
-- Deliberately a plain text equality (`= 'true'`), NOT `::boolean` — confirmed empirically that once
-- a custom GUC has been referenced at all on a physical connection (even via a since-ended
-- `SET LOCAL`), Postgres registers a placeholder for it, and `current_setting(name, true)` returns
-- `''` (not NULL) for the rest of that connection's life instead of raising "unrecognized
-- configuration parameter". `''::boolean` throws, and since connections here are drawn from the same
-- pool `apps/api/src/plugins/tenant-context.ts` also uses, a later ordinary tenant-scoped request on
-- a recycled connection that never touches `app.subdomain_lookup` would otherwise intermittently
-- break on this policy's clause. A plain text comparison never throws: NULL = 'true' and '' = 'true'
-- are both simply `false` (row excluded), never an error.
CREATE POLICY "tenant_subdomain_lookup" ON "tenants"
  FOR SELECT
  USING (current_setting('app.subdomain_lookup', true) = 'true');
