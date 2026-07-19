-- RLS for scorm_cmi_interactions, mirroring 0086_rls_scorm_packages.sql.
ALTER TABLE "scorm_cmi_interactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scorm_cmi_interactions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "scorm_cmi_interactions"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
