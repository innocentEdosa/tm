-- Tenant Management spec, research.md §8 — closes a gap flagged since 0009_rls_tenants.sql's own
-- comment: "a future platform-wide 'list all tenants' console needs its own narrow ... read path".
-- This is that console. Additive permissive policy, identical shape to the already-shipped
-- form_fields.super_admin_full_access (0028_rls_custom_fields.sql) — the existing tenant_isolation
-- policy (0009) is left completely unedited, so no ordinary tenant-scoped connection gains any new
-- access; only a verified Super Admin session (app.is_super_admin set by
-- super-admin-context.ts) does. Every route in apps/api/src/tenant-management/ reads/writes tenants
-- through request.superAdminDb to exercise this policy, never fastify.pg.pool directly.
CREATE POLICY "super_admin_full_access" ON "tenants"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
