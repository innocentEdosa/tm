-- Establishes tm_app's table privileges for business_objective_categories, mirroring
-- 0071_lock_course_catalog_grants.sql. Tenant-scoped table: full CRUD for the app (insert-heavy —
-- resolve-or-create on every objective save), enforced per-request by RLS (0134), not by
-- table-level grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON business_objective_categories TO tm_app;
