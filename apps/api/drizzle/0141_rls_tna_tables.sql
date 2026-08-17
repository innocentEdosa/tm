-- RLS for the three TNA tables, kept as its own migration (separate from schema-creation 0140),
-- matching this codebase's established convention for brand-new tenant-scoped tables (e.g.
-- 0046_rls_training_needs.sql). Standard single tenant_isolation policy per table — every row here
-- always belongs to exactly one tenant, never a global/shared row. Uses the hardened
-- `NULLIF(current_setting('app.tenant_id', true), '')::uuid` cast from the start
-- (0032_harden_tenant_isolation_uuid_cast.sql's fix).
ALTER TABLE "tna_exercises" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tna_exercises" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "tna_exercises"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "tna_exercise_targets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tna_exercise_targets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "tna_exercise_targets"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "tna_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tna_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "tna_assignments"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
