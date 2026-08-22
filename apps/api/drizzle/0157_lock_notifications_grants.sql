-- Establishes tm_app's table privileges for notifications, mirroring 0151_lock_tna_responses_grants.sql.
-- Tenant-scoped table: full CRUD for the app, enforced per-request by RLS (0156), not by table-level
-- grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO tm_app;
