-- Seeds the four default role templates (FR-004) and their permission mappings.
-- Mapping: `super_admin` gets every permission (it's the platform-operator role, seeded once
-- platform-wide by 0007 — never copied per-tenant). `hr_admin` additionally gets `manage_roles`
-- per spec.md User Story 3 ("As an HR/L&D admin within a tenant, I can rename a default role...").
-- `manager` gets read/approve-oriented permissions only. `employee` (baseline learner) gets none.
INSERT INTO "role_templates" ("key", "name", "description", "is_platform_only") VALUES
  ('super_admin', 'Super Admin', 'Platform operator role. Not assignable within any tenant.', true),
  ('hr_admin', 'HR/L&D Admin', 'Full access to course, enrollment, and department administration.', false),
  ('manager', 'Manager', 'Approves enrollments and views analytics for their department.', false),
  ('employee', 'Employee/Learner', 'Baseline learner role with no administrative permissions.', false);

INSERT INTO "role_template_permissions" ("role_template_id", "permission_id")
SELECT rt.id, p.id
FROM "role_templates" rt
CROSS JOIN "permissions" p
WHERE rt.key = 'super_admin';

INSERT INTO "role_template_permissions" ("role_template_id", "permission_id")
SELECT rt.id, p.id
FROM "role_templates" rt
JOIN "permissions" p ON p.key IN (
  'approve_enrollment', 'edit_content_library', 'view_department_analytics', 'manage_roles'
)
WHERE rt.key = 'hr_admin';

INSERT INTO "role_template_permissions" ("role_template_id", "permission_id")
SELECT rt.id, p.id
FROM "role_templates" rt
JOIN "permissions" p ON p.key IN ('approve_enrollment', 'view_department_analytics')
WHERE rt.key = 'manager';

-- 'employee' intentionally gets zero role_template_permissions rows.
