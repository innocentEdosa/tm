-- Establishes tm_app's table privileges for business_objectives, mirroring
-- 0047_lock_training_needs_grants.sql. Tenant-scoped table: full CRUD for the app, enforced
-- per-request by RLS (0128), not by table-level grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON business_objectives TO tm_app;
