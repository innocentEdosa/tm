-- RLS for scorm_package_items, mirroring 0086_rls_scorm_packages.sql.
ALTER TABLE "scorm_package_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scorm_package_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "scorm_package_items"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
