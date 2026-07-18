-- RLS for course_modules, kept as its own migration (separate from schema-creation 0075), matching
-- this codebase's established convention for brand-new tables (e.g. 0069_rls_course_categories.sql).
-- Standard single tenant_isolation policy — every row here always belongs to exactly one tenant, never
-- a global/shared row (research.md §2). Uses the hardened
-- `NULLIF(current_setting('app.tenant_id', true), '')::uuid` cast from the start
-- (0032_harden_tenant_isolation_uuid_cast.sql's fix).
ALTER TABLE "course_modules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "course_modules" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "course_modules"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
