-- Seeds forms.manage.global / forms.manage.tenant (spec FR-002/FR-003) and grants
-- forms.manage.tenant to the hr_admin role template + retroactively to every already-live tenant
-- role, matching by role NAME (not only source_template_id) in the same statement, per
-- 0025/0026_*.sql's own combined lesson — most existing "HR/L&D Admin" rows have a NULL
-- source_template_id, so name-matching from the start avoids needing a second corrective migration.
-- forms.manage.global is Super Admin-only and is never granted to any tenant role template.
INSERT INTO "permissions" ("key", "display_name", "description", "category") VALUES
  ('forms.manage.global', 'Manage Global Form Fields', 'Create, edit, reorder, and archive Super-Admin global default fields for any form type.', 'forms'),
  ('forms.manage.tenant', 'Manage Tenant Form Fields', 'Add, edit, reorder, and archive this tenant''s own custom fields on any form type.', 'forms');

-- Grant forms.manage.tenant to the hr_admin role_template, for future reseeds/provisioning of new
-- tenants.
INSERT INTO "role_template_permissions" ("role_template_id", "permission_id")
SELECT rt.id, p.id
FROM "role_templates" rt
CROSS JOIN "permissions" p
WHERE rt.key = 'hr_admin' AND p.key = 'forms.manage.tenant';

-- Also grant to every already-live tenant role sourced from hr_admin (by source_template_id where
-- present) OR named "HR/L&D Admin" (covering the majority of rows that predate that link) — a
-- single idempotent statement, gated on not already holding the permission.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE p.key = 'forms.manage.tenant'
  AND (
    r.name = 'HR/L&D Admin'
    OR r.source_template_id IN (SELECT id FROM "role_templates" WHERE key = 'hr_admin')
  )
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
