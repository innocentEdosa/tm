-- RLS for training_needs, kept as its own migration (separate from schema-creation 0045),
-- matching this codebase's established convention for brand-new tables (e.g.
-- 0034_rls_form_field_order_overrides.sql). Standard single tenant_isolation policy — every row
-- here always belongs to exactly one tenant, never a global/shared row (research.md §1). Uses the
-- hardened `NULLIF(current_setting('app.tenant_id', true), '')::uuid` cast from the start
-- (0032_harden_tenant_isolation_uuid_cast.sql's fix), not the older plain cast `0010` used.
ALTER TABLE "training_needs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "training_needs" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "training_needs"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
