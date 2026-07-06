-- Seeds department.view / department.manage (spec FR-019 supersedes nothing; Department Management
-- spec 009) and grants both to the hr_admin role template + retroactively to every existing tenant's
-- already-live hr_admin-sourced role row — mirrors 0014_seed_provision_tenant_permission.sql /
-- 0022_seed_tenant_auth_permissions.sql's precedent, so the feature is usable immediately after
-- deploy rather than requiring a manual per-tenant role edit first.
INSERT INTO "permissions" ("key", "display_name", "description", "category") VALUES
  ('department.view', 'View Departments', 'View the department list and hierarchy for a tenant.', 'department'),
  ('department.manage', 'Manage Departments', 'Create, edit, archive, and delete departments for a tenant.', 'department');

-- Grant to the hr_admin role_template, for future reseeds/provisioning of new tenants.
INSERT INTO "role_template_permissions" ("role_template_id", "permission_id")
SELECT rt.id, p.id
FROM "role_templates" rt
CROSS JOIN "permissions" p
WHERE rt.key = 'hr_admin' AND p.key IN ('department.view', 'department.manage');

-- Also grant to every already-live tenant's hr_admin-sourced role row.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
JOIN "role_templates" rt ON rt.id = r.source_template_id
CROSS JOIN "permissions" p
WHERE rt.key = 'hr_admin' AND p.key IN ('department.view', 'department.manage');
