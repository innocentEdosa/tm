-- RLS for content_items, kept as its own migration (separate from schema-creation 0075), matching
-- this codebase's established convention for brand-new tables. Standard single tenant_isolation
-- policy — every row here always belongs to exactly one tenant, never a global/shared row
-- (research.md §2). Uses the hardened `NULLIF(current_setting('app.tenant_id', true), '')::uuid` cast
-- from the start (0032_harden_tenant_isolation_uuid_cast.sql's fix).
ALTER TABLE "content_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "content_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "content_items"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
