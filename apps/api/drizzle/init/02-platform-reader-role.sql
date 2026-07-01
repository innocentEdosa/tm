-- Local-dev bootstrap only (see 01-app-role.sql for the docker-entrypoint-initdb.d mechanics).
--
-- `tm_platform_reader`: a narrowly-scoped, BYPASSRLS role used ONLY to verify platform Super
-- Admin membership (contracts/super-admin-catalog-api.md). RLS on `roles`/`user_roles` makes the
-- one `tenant_id IS NULL` Super Admin row unreachable through the normal `tm_app` tenant-scoped
-- connection by design (FR-007) — that's correct for every tenant-facing path, but it also means
-- there is no way, using only `tm_app`, to DB-verify "is this caller the Super Admin." This role
-- is the intentionally distinct, minimal exception: SELECT-only on exactly the tables needed
-- (`roles`, `user_roles`, `role_permissions`, `permissions` — granted in
-- 0008_platform_reader_grants.sql), used by exactly one function (`isSuperAdminWithPermission` in
-- `apps/api/src/permissions/require-platform-permission.ts`) — never exposed to any tenant-facing
-- code path or route.
--
-- Production/staging (Neon): an operator must create the equivalent role by hand once, per
-- drizzle/README.md, same as `tm_app`.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'tm_platform_reader') THEN
    CREATE ROLE tm_platform_reader WITH LOGIN PASSWORD 'tm_platform_reader_password'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE tm_dev TO tm_platform_reader;
GRANT USAGE ON SCHEMA public TO tm_platform_reader;
