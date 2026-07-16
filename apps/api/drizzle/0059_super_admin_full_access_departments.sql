-- Super Admin Tenant Console spec, research.md §3 — additive permissive policy, identical shape to
-- the already-shipped tenants.super_admin_full_access (0054) and user_sessions.super_admin_full_access
-- (0055). The existing tenant_isolation policy (0010_rls_departments.sql) is left completely
-- unedited, so no ordinary tenant-scoped connection gains any new access; only a verified Super Admin
-- session (app.is_super_admin set by super-admin-context.ts) does. Every route in
-- apps/api/src/super-admin-tenant-console/ reads departments through request.superAdminDb to exercise
-- this policy, never fastify.pg.pool or request.tenantDb directly — and always with an explicit
-- tenant_id filter supplied by the route's own :id param (plan.md Summary, research.md §1), since
-- this connection's app.tenant_id is pinned to the nil UUID, not the target tenant.
CREATE POLICY "super_admin_full_access" ON "departments"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
