-- Super Admin Tenant Console spec, research.md §3 — same additive-policy shape as
-- 0059_super_admin_full_access_departments.sql. This is the one table this feature also *writes*
-- to (users.password_hash, via the password-reset action) — write access at the RLS layer is
-- identical in shape to the already-shipped tenants/user_sessions policies (0054/0055), which are
-- also nominally read/write capable; the actual restriction to "only password_hash, only one row" is
-- enforced entirely at the application layer (reset-member-password.ts), scoped by an explicit
-- tenant_id AND id predicate supplied by the route's own params, never by this connection's ambient
-- RLS context (research.md §1, §3). tenant_isolation (0011_rls_users.sql) is left completely
-- unedited.
CREATE POLICY "super_admin_full_access" ON "users"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
