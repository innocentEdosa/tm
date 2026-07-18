-- RLS for course_categories, kept as its own migration (separate from schema-creation 0068),
-- matching this codebase's established convention for brand-new tables (e.g.
-- 0046_rls_training_needs.sql). Standard single tenant_isolation policy — every row here always
-- belongs to exactly one tenant, never a global/shared row (research.md §2). Uses the hardened
-- `NULLIF(current_setting('app.tenant_id', true), '')::uuid` cast from the start
-- (0032_harden_tenant_isolation_uuid_cast.sql's fix), not the older plain cast `0010` used.
ALTER TABLE "course_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "course_categories" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "course_categories"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
