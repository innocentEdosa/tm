-- RLS for course_reviews, kept as its own migration (separate from schema-creation 0093), matching
-- this codebase's established convention for brand-new tables. Standard single tenant_isolation
-- policy — every row here always belongs to exactly one tenant, never a global/shared row.
ALTER TABLE "course_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "course_reviews" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "course_reviews"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);