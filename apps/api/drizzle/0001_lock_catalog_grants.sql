-- Establishes the app-runtime role's table privileges (FR-002). Run as the migration/owner role;
-- grants/revokes below target "tm_app", the restricted role the running server connects as
-- (see drizzle/init/01-app-role.sql and drizzle/README.md). Table ownership stays with the
-- migration role, which is what makes these REVOKEs actually binding on tm_app.

-- Platform-global catalog: read-only for the app. No tenant or application code path may create,
-- rename, or delete a permission/template — only a schema migration can.
GRANT SELECT ON permissions, role_templates, role_template_permissions TO tm_app;
REVOKE INSERT, UPDATE, DELETE ON permissions, role_templates, role_template_permissions FROM tm_app;

-- Tenant-scoped tables: full CRUD for the app, enforced per-request by RLS (0002-0004), not by
-- table-level grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON roles, role_permissions, user_roles TO tm_app;
