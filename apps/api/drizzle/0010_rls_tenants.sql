-- Row-Level Security on `tenants`. `id` IS the tenant_id, so this uses the same idiom as every
-- other tenant-scoped table, just keyed on `id` instead of a separate `tenant_id` column. A new
-- tenant's `app.tenant_id` is set to its own not-yet-inserted `id` before the INSERT runs
-- (research.md §1), so WITH CHECK passes for exactly that one row. This means tm_app can never
-- enumerate other tenants — a future platform-wide "list all tenants" console needs its own narrow
-- BYPASSRLS read path (data-model.md `tenants` Isolation), not a change to this policy.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "tenants"
  USING (id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (id = current_setting('app.tenant_id', true)::uuid);
