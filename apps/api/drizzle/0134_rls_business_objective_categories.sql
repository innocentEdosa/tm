-- RLS for business_objective_categories, kept as its own migration (separate from schema-creation
-- 0133), matching this codebase's established convention for brand-new tenant-scoped tables (e.g.
-- 0069_rls_course_categories.sql). Standard single tenant_isolation policy — every row here always
-- belongs to exactly one tenant, never a global/shared row.
ALTER TABLE "business_objective_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_objective_categories" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "business_objective_categories"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
