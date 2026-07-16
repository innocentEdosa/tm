-- Super Admin Tenant Console spec, research.md §3 — same additive-policy shape as
-- 0059_super_admin_full_access_departments.sql, needed here so the Roles tab can resolve each role's
-- permissionKeys through request.superAdminDb. tenant_isolation (0003_rls_role_permissions.sql) is
-- left completely unedited.
CREATE POLICY "super_admin_full_access" ON "role_permissions"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
