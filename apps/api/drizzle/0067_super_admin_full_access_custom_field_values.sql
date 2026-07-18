-- Super Admin Edit Tenant Configuration spec (022) — discovered during implementation (not
-- anticipated in planning): `form_fields` already carries a `super_admin_full_access` policy
-- (migration 0028), but `custom_field_values` — a separate table with its own RLS — does not. The
-- member-edit surface (US1) writes tenant-scoped custom field *values* (not definitions) via
-- `custom_field_values`, which failed with "new row violates row-level security policy" under a
-- Super Admin session until this additive policy exists. Same shape as every other
-- `super_admin_full_access` policy in this codebase (0059-0061, 0054-0055) — the existing
-- `tenant_isolation` policy (0028) is left completely unedited, so no ordinary tenant-scoped
-- connection gains any new access; only a verified Super Admin session
-- (app.is_super_admin set by super-admin-context.ts) does. `tm_app` already has full
-- SELECT/INSERT/UPDATE/DELETE table-level grants on this table (0029) — only the missing RLS policy
-- blocked the write.
CREATE POLICY "super_admin_full_access" ON "custom_field_values"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
