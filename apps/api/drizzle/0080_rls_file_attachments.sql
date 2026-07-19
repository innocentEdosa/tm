-- RLS for file_attachments, kept as its own migration (separate from schema-creation 0079), matching
-- this codebase's established convention for brand-new tables. Standard single tenant_isolation
-- policy — every row here always belongs to exactly one tenant, never a global/shared row
-- (research.md §3). Uses the hardened `NULLIF(current_setting('app.tenant_id', true), '')::uuid` cast
-- from the start (0032_harden_tenant_isolation_uuid_cast.sql's fix).
ALTER TABLE "file_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "file_attachments" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "file_attachments"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
