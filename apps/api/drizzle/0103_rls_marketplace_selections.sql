-- RLS for marketplace_selections, kept as its own migration (separate from schema-creation 0102),
-- matching this codebase's established convention for brand-new tables. Two policies from the start
-- (research.md §3 of spec 029): the standard tenant_isolation policy (hardened NULLIF(...) cast,
-- mirrors 0080_rls_file_attachments.sql) so a tenant's own request.tenantDb only ever sees its own
-- rows, plus super_admin_full_access (identical shape to 0054_super_admin_full_access_tenants.sql) so
-- the Super Admin cross-tenant pending-selection queue, read via request.superAdminDb, can see every
-- tenant's rows. Both policies are permissive and OR'd together by Postgres for the same command.
ALTER TABLE "marketplace_selections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketplace_selections" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "marketplace_selections"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY "super_admin_full_access" ON "marketplace_selections"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
