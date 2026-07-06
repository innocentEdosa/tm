-- Corrective follow-up to 0028_rls_custom_fields.sql. `tenant_isolation`'s `current_setting('app.tenant_id', true)::uuid`
-- cast (copied verbatim from every prior tenant table's own policy, e.g. 0009-0011) throws
-- "invalid input syntax for type uuid" instead of evaluating to false, on any connection where
-- `app.tenant_id` was referenced by an earlier, already-ended transaction and never set again in
-- the current one — the same class of GUC-reuse gotcha 0018's own comment documents for
-- `app.subdomain_lookup`, discovered here via `custom_field_values`/`form_fields`'s new
-- `super_admin_full_access` transaction (research.md §1), which legitimately never sets
-- `app.tenant_id` at all. Never manifested on `departments`/`users`/`tenants` because every real
-- request that reaches them always sets `app.tenant_id` first (tenant-context.ts) — but it's a
-- real, if latent, bug for these two new tables once a Super Admin request (which never touches
-- `app.tenant_id`) reuses a pooled connection previously used by a tenant request. `NULLIF(..., '')`
-- turns the empty-string case into `NULL` before the cast, so the comparison evaluates to `NULL`
-- (row excluded) instead of throwing.
DROP POLICY "tenant_isolation" ON "form_fields";
CREATE POLICY "tenant_isolation" ON "form_fields"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY "tenant_isolation" ON "custom_field_values";
CREATE POLICY "tenant_isolation" ON "custom_field_values"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
