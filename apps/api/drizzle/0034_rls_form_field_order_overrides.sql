-- RLS for form_field_order_overrides, kept as its own migration (separate from schema-creation
-- 0033), matching this codebase's established convention for brand-new tables. Standard single
-- tenant_isolation policy — every row here always belongs to exactly one tenant (its own reordering
-- preference), never a global/shared row, unlike form_fields.
ALTER TABLE "form_field_order_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "form_field_order_overrides" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "form_field_order_overrides"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
