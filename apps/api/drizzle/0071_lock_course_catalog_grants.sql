-- Establishes tm_app's table privileges for this feature's tables, mirroring
-- 0012_lock_department_catalog_grants.sql.

-- Platform-global catalog: read-only for the app. Only a schema migration can add/rename/remove a
-- course category template.
GRANT SELECT ON course_category_templates TO tm_app;
REVOKE INSERT, UPDATE, DELETE ON course_category_templates FROM tm_app;

-- Tenant-scoped tables: full CRUD for the app, enforced per-request by RLS (0069-0070), not by
-- table-level grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON course_categories, courses TO tm_app;
