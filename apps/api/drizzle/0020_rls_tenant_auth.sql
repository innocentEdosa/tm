-- Row-Level Security on the three new tenant-scoped tables (Tenant Authentication Configuration
-- spec) — the standard `tenant_isolation` policy shape, identical to every other tenant-scoped
-- table (roles, tenants, departments, users). No narrow allowance-clause policy is needed here,
-- unlike Spec 4's pre-auth subdomain lookup: `tenant_id` is always independently resolved from the
-- subdomain *before* any of these tables are queried (research.md §3, §5), so the standard policy
-- alone makes a row from a different tenant structurally invisible.

ALTER TABLE "tenant_auth_methods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_auth_methods" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "tenant_auth_methods"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "user_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_sessions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "user_sessions"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "password_reset_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "password_reset_tokens" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "password_reset_tokens"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
