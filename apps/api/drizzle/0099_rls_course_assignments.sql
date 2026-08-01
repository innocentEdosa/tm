-- RLS for course_assignments, kept as its own migration (separate from schema-creation 0098),
-- matching this codebase's established convention for brand-new tables. Standard single
-- tenant_isolation policy — every row here always belongs to exactly one tenant, never a
-- global/shared row. Uses the hardened `NULLIF(current_setting('app.tenant_id', true), '')::uuid`
-- cast from the start (0032_harden_tenant_isolation_uuid_cast.sql's fix).
ALTER TABLE "course_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "course_assignments" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "course_assignments"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
