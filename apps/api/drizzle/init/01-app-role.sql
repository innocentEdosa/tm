-- Local-dev bootstrap only: docker-entrypoint-initdb.d runs this once, on first container start
-- against a fresh volume. It creates the restricted role the running Fastify app connects as
-- (APP_DATABASE_URL), distinct from the superuser role migrations run as (DATABASE_URL /
-- POSTGRES_USER). This split is what makes 0001_lock_catalog_grants.sql's REVOKEs meaningful:
-- a table owner (or superuser) always retains implicit write rights that GRANT/REVOKE cannot take
-- away, so the app must connect as a non-owning, non-superuser role for FR-002 to be a real,
-- DB-enforced guarantee rather than cosmetic SQL.
--
-- Production/staging (Neon): Neon does not support docker-entrypoint-initdb.d. An operator must
-- create the equivalent restricted role once, by hand or via a one-time admin script, against the
-- Neon project before running migrations there. See drizzle/README.md.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'tm_app') THEN
    CREATE ROLE tm_app WITH LOGIN PASSWORD 'tm_app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE tm_dev TO tm_app;
GRANT USAGE ON SCHEMA public TO tm_app;
