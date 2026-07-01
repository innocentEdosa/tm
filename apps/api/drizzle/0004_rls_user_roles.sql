-- Row-Level Security on `user_roles`. `tenant_id` is denormalized directly on this table (not
-- derived solely via the `role_id` join) so this policy doesn't need a subquery — see data-model.md.
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "user_roles"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
