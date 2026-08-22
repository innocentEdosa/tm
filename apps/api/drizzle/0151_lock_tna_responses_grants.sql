-- Establishes tm_app's table privileges for tna_responses, mirroring 0142_lock_tna_grants.sql.
-- Tenant-scoped table: full CRUD for the app, enforced per-request by RLS (0150), not by
-- table-level grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON tna_responses TO tm_app;
