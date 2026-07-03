-- Establishes tm_app's table privileges for this feature's tables, mirroring Spec 1's
-- 0001_lock_catalog_grants.sql.

-- Platform-global catalog: read-only for the app. Only a schema migration can add/rename/remove a
-- department template.
GRANT SELECT ON department_templates TO tm_app;
REVOKE INSERT, UPDATE, DELETE ON department_templates FROM tm_app;

-- Tenant-scoped tables: full CRUD for the app, enforced per-request by RLS (0010-0012), not by
-- table-level grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, departments, users TO tm_app;
