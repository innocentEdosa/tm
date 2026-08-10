-- RLS for tenant_form_cta_overrides, kept as its own migration (separate from schema-creation
-- 0114), matching this codebase's established convention for brand-new tables (e.g.
-- 0034_rls_form_field_order_overrides.sql). Standard single tenant_isolation policy — every row
-- here always belongs to exactly one tenant's own CTA wording, never a global/shared row.
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_form_cta_overrides TO tm_app;

ALTER TABLE "tenant_form_cta_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_form_cta_overrides" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "tenant_form_cta_overrides"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
