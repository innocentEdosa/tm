-- RLS for the AI Foundation's three tables, kept as its own migration (separate from
-- schema-creation 0120), matching this codebase's established convention for brand-new tables
-- (e.g. 0046_rls_training_needs.sql). Every row in all three always belongs to exactly one
-- tenant — there is no platform-level/shared row shape here (unlike form_fields/form_versions),
-- so a single tenant_isolation policy per table is sufficient. Uses the hardened
-- `NULLIF(current_setting('app.tenant_id', true), '')::uuid` cast (0032's fix), not the older
-- plain cast.
ALTER TABLE "ai_conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_conversations" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "ai_conversations"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "ai_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_messages" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "ai_messages"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "ai_tool_executions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_tool_executions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "ai_tool_executions"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);