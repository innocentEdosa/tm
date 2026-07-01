-- Row-Level Security on `role_permissions`, scoped via its owning `roles` row (this join table has
-- no `tenant_id` column of its own — see data-model.md).
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "role_permissions"
  USING (EXISTS (
    SELECT 1 FROM "roles" r
    WHERE r.id = "role_permissions".role_id
      AND r.tenant_id = current_setting('app.tenant_id', true)::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "roles" r
    WHERE r.id = "role_permissions".role_id
      AND r.tenant_id = current_setting('app.tenant_id', true)::uuid
  ));
