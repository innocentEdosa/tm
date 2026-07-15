-- Tenant Management spec, research.md §8 — same additive-policy shape as
-- 0054_super_admin_full_access_tenants.sql, needed here so the archive/delete session-revoke step
-- (UPDATE user_sessions SET revoked_at = now() WHERE tenant_id = :id) can actually match rows from a
-- Super-Admin-context connection, which never sets app.tenant_id. tenant_isolation
-- (0020_rls_tenant_auth.sql) is left completely unedited.
CREATE POLICY "super_admin_full_access" ON "user_sessions"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
