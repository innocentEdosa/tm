-- Establishes tm_app's table privileges for this feature's tables. Neither table has RLS (no
-- tenant_id column — data-model.md `super_admins`/`super_admin_sessions`), so isolation here is
-- enforced entirely at the grant level, not by row-level policy.

-- No INSERT on super_admins for tm_app, deliberately: the running server can never create a Super
-- Admin account. Only the standalone seed script, connecting as the migration/owner role, can
-- (research.md §7). SELECT (login lookup) and UPDATE (last_login_at, failed_login_count,
-- locked_until) are the only operations the running server ever performs on this table.
GRANT SELECT, UPDATE ON super_admins TO tm_app;

-- super_admin_sessions: the running server creates sessions on login, reads them on every
-- authenticated request, and marks them revoked on logout.
GRANT SELECT, INSERT, UPDATE ON super_admin_sessions TO tm_app;
