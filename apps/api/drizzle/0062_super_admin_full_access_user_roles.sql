-- Super Admin Tenant Console spec, research.md §3 — same additive-policy shape as
-- 0059_super_admin_full_access_departments.sql, needed here so the Members tab can resolve each
-- member's role name, and the Roles tab each role's memberCount, through request.superAdminDb.
-- tenant_isolation (0004_rls_user_roles.sql) is left completely unedited.
CREATE POLICY "super_admin_full_access" ON "user_roles"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
