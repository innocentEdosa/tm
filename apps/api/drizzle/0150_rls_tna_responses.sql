-- RLS for tna_responses, matching 0141_rls_tna_tables.sql's own convention for the other TNA
-- tables. Standard single tenant_isolation policy — every row here always belongs to exactly one
-- tenant, never a global/shared row.
ALTER TABLE "tna_responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tna_responses" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "tna_responses"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
