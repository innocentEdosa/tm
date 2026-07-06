-- Establishes tm_app's table privileges for this feature's tables, mirroring
-- 0001_lock_catalog_grants.sql / 0012_lock_department_catalog_grants.sql.

-- Platform-global catalog: read-only for the app. Only a schema migration can add a form type.
GRANT SELECT ON form_definitions TO tm_app;
REVOKE INSERT, UPDATE, DELETE ON form_definitions FROM tm_app;

-- Tenant-scoped (dual-visibility) tables: full CRUD for the app, enforced per-request by RLS
-- (0028), not by table-level grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON form_fields, custom_field_values TO tm_app;
