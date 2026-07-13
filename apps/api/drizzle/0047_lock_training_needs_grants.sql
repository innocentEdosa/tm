-- Establishes tm_app's table privileges for training_needs, mirroring
-- 0012_lock_department_catalog_grants.sql. Tenant-scoped table: full CRUD for the app, enforced
-- per-request by RLS (0046), not by table-level grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON training_needs TO tm_app;
