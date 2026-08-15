-- Establishes tm_app's table privileges for platform_settings. No RLS (platform-level, no
-- tenant_id column), so isolation here is enforced at the grant level plus route-level auth: the
-- read route (GET /platform/theme) is intentionally public, the write route (PATCH /platform/theme)
-- gates on requireSuperAdminSession.

-- SELECT for the public read; INSERT/UPDATE for the upsert a Super Admin's write performs (no row
-- exists yet the first time a setting is written, hence both grants rather than UPDATE alone). No
-- DELETE grant — nothing in this codebase should ever remove a settings row.
GRANT SELECT, INSERT, UPDATE ON platform_settings TO tm_app;
