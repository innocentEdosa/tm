-- Super Admin Tenant Console spec, research.md §3 — same additive-policy shape as
-- 0059_super_admin_full_access_departments.sql, needed here so the Roles tab
-- (GET /tenants/:id/roles) can read a tenant's role catalog through request.superAdminDb.
-- tenant_isolation (0002_rls_roles.sql) is left completely unedited.
CREATE POLICY "super_admin_full_access" ON "roles"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
