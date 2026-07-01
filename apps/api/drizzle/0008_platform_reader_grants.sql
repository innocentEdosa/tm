-- Grants for `tm_platform_reader` (see drizzle/init/02-platform-reader-role.sql). SELECT-only,
-- and only on the tables `isSuperAdminWithPermission` needs (require-platform-permission.ts) —
-- this role must never be granted write access or broader read access, since BYPASSRLS already
-- makes it exempt from tenant isolation.
GRANT SELECT ON roles, user_roles, role_permissions, permissions TO tm_platform_reader;
