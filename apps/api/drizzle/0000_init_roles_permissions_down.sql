-- Paired down-migration for 0000_init_roles_permissions.sql.
-- Drops the six tables in reverse FK-dependency order. Not run automatically by drizzle-kit
-- (which only supports forward migrations) — apply by hand per drizzle/README.md's rollback
-- runbook, only ever against a target lower than 0000 (i.e. a full teardown of this feature).
DROP TABLE IF EXISTS "user_roles";
DROP TABLE IF EXISTS "role_permissions";
DROP TABLE IF EXISTS "roles";
DROP TABLE IF EXISTS "role_template_permissions";
DROP TABLE IF EXISTS "role_templates";
DROP TABLE IF EXISTS "permissions";
