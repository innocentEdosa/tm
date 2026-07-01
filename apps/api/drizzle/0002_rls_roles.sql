-- Row-Level Security on `roles`. `current_setting('app.tenant_id', true)` returns NULL when unset
-- (the `true` arg = missing_ok), and `tenant_id = NULL` is never true in SQL — so this fails closed
-- for both an unset app.tenant_id AND for the one row where tenant_id IS NULL (the platform Super
-- Admin role), satisfying FR-007 without a separate carve-out.
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "roles"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
