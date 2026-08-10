-- Form Builder spec (033) — reopens `form_definitions` to runtime writes (previously locked by
-- 0029_lock_custom_fields_catalog_grants.sql to "only a schema migration can add a form type")
-- and establishes grants/RLS for the three new platform-global tables (`form_versions`,
-- `form_steps`, `form_sections`). Mirrors the existing `super_admin_full_access` policy shape
-- used on 6+ other tables (e.g. 0067_super_admin_full_access_custom_field_values.sql,
-- 0059_super_admin_full_access_departments.sql) — table-level GRANT to `tm_app` plus RLS
-- restricting writes to a verified Super Admin session (`app.is_super_admin` set by
-- apps/api/src/platform-auth/super-admin-context.ts). No ordinary tenant-scoped connection gains
-- any new write access: `tenant_isolation`-style policies are never added to these tables because
-- they carry no `tenant_id` — only `super_admin_full_access` ever permits a write.

-- `form_definitions`: DELETE intentionally stays revoked — archived (via `status`), never
-- hard-deleted, matching this codebase's soft-delete convention elsewhere.
GRANT INSERT, UPDATE ON form_definitions TO tm_app;

ALTER TABLE "form_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "form_definitions" FORCE ROW LEVEL SECURITY;

-- Every tenant session (and Super Admin) can read every form type — this was previously true by
-- default (grants-only, no RLS on this table); this policy preserves that read behavior now that
-- RLS is enabled.
CREATE POLICY "readable_by_all" ON "form_definitions"
  FOR SELECT
  USING (true);

CREATE POLICY "super_admin_full_access" ON "form_definitions"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');

-- `form_versions` / `form_steps` / `form_sections`: same shape as `form_definitions` — readable
-- by every tenant session (they read a form type's *published* structure), writable only by a
-- Super Admin session.
GRANT SELECT, INSERT, UPDATE, DELETE ON form_versions, form_steps, form_sections TO tm_app;

ALTER TABLE "form_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "form_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "readable_by_all" ON "form_versions" FOR SELECT USING (true);
CREATE POLICY "super_admin_full_access" ON "form_versions"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');

ALTER TABLE "form_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "form_steps" FORCE ROW LEVEL SECURITY;
CREATE POLICY "readable_by_all" ON "form_steps" FOR SELECT USING (true);
CREATE POLICY "super_admin_full_access" ON "form_steps"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');

ALTER TABLE "form_sections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "form_sections" FORCE ROW LEVEL SECURITY;
CREATE POLICY "readable_by_all" ON "form_sections" FOR SELECT USING (true);
CREATE POLICY "super_admin_full_access" ON "form_sections"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
