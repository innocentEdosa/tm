-- RLS for business_objectives, kept as its own migration (separate from schema-creation 0127),
-- matching this codebase's established convention for brand-new tenant-scoped tables (e.g.
-- 0046_rls_training_needs.sql). Standard single tenant_isolation policy — every row here always
-- belongs to exactly one tenant, never a global/shared row. Uses the hardened
-- `NULLIF(current_setting('app.tenant_id', true), '')::uuid` cast from the start
-- (0032_harden_tenant_isolation_uuid_cast.sql's fix).
ALTER TABLE "business_objectives" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_objectives" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "business_objectives"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
