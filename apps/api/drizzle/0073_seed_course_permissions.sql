-- Seeds course.view / course.manage (spec Course Creation, 023) and grants both to the hr_admin
-- role template + retroactively to every existing tenant's already-live hr_admin-sourced role row —
-- mirrors 0025_seed_department_permissions.sql's precedent, matched by both source_template_id and
-- role name in the same statement from the start (the combined approach 0031/0038 already learned
-- from 0025/0026's original two-step lesson), so the feature is usable immediately after deploy
-- rather than requiring a manual per-tenant role edit first.
INSERT INTO "permissions" ("key", "display_name", "description", "category") VALUES
  ('course.view', 'View Courses', 'View the course catalog for a tenant.', 'course'),
  ('course.manage', 'Manage Courses', 'Create, edit, and archive courses for a tenant.', 'course');

-- Grant to the hr_admin role_template, for future reseeds/provisioning of new tenants.
INSERT INTO "role_template_permissions" ("role_template_id", "permission_id")
SELECT rt.id, p.id
FROM "role_templates" rt
CROSS JOIN "permissions" p
WHERE rt.key = 'hr_admin' AND p.key IN ('course.view', 'course.manage');

-- Backfill onto every already-live tenant role sourced from hr_admin (by source_template_id where
-- present, or by exact role name), gated on not already holding the permission (idempotent).
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE p.key IN ('course.view', 'course.manage')
  AND (
    r.name = 'HR/L&D Admin'
    OR r.source_template_id IN (SELECT id FROM "role_templates" WHERE key = 'hr_admin')
  )
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
