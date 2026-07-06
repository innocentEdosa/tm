-- Row-Level Security on `form_fields` and `custom_field_values`. Kept as its own migration, separate
-- from the schema-creation migration (0027), matching this codebase's established convention for
-- brand-new tables (0000 -> 0002-0004; 0008 -> 0009-0011), rather than combining schema and RLS in
-- one file.
--
-- `custom_field_values` gets the standard single tenant_isolation policy, like every other
-- tenant-owned table.
ALTER TABLE "custom_field_values" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_field_values" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "custom_field_values"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- `form_fields` gets this codebase's first *dual-visibility* shape (research.md §1, data-model.md):
-- three composed permissive policies, OR'd together by Postgres for the same command.
ALTER TABLE "form_fields" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "form_fields" FORCE ROW LEVEL SECURITY;

-- 1. Standard tenant-owner shape — a tenant session can read/write only its own rows. Because a
--    global row's tenant_id is NULL, `tenant_id = current_setting(...)::uuid` is NULL (not true) for
--    it, so this policy alone never grants a tenant session write access to a global row.
CREATE POLICY "tenant_isolation" ON "form_fields"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- 2. Read-only allowance for global rows — mirrors 0018_rls_tenants_subdomain_lookup.sql's
--    additive, FOR-SELECT-only permissive-policy technique. Grants no write capability at all.
CREATE POLICY "global_fields_readable" ON "form_fields"
  FOR SELECT
  USING (tenant_id IS NULL);

-- 3. Super Admin full access — completes the `app.is_super_admin` allowance clause that
--    apps/api/src/platform-auth/super-admin-context.ts has set on every Super Admin request's
--    transaction since the Super Admin Authentication spec, but which no table's policy has actually
--    referenced until now (spec FR-002 — data-model support for the not-yet-built Super Admin
--    authoring screen). Deliberately a plain text comparison (`= 'true'`), not `::boolean` — same
--    reasoning as 0018's own comment: a custom GUC that's ever been referenced on a connection
--    returns '' (not NULL) once unset again, and ''::boolean throws, so a plain text comparison is
--    the only form that never errors on a recycled pooled connection.
CREATE POLICY "super_admin_full_access" ON "form_fields"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
