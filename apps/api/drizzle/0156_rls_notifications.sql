-- RLS for notifications, matching 0150_rls_tna_responses.sql's own convention (itself mirroring
-- 0141_rls_tna_tables.sql). Standard single tenant_isolation policy — every row here always belongs
-- to exactly one tenant, never a global/shared row.
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "notifications"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
