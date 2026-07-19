-- RLS for scorm_packages, kept as its own migration (separate from schema-creation 0085), matching
-- this codebase's established convention for brand-new tables. Standard single tenant_isolation
-- policy, hardened NULLIF(...) cast from the start.
ALTER TABLE "scorm_packages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scorm_packages" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "scorm_packages"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
