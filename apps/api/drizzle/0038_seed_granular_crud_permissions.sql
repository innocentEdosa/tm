-- Granular Permissions (spec 011 addendum): introduces separate create/read/edit/delete keys
-- alongside each module's existing coarse "manage" permission — purely additive. No existing
-- permission key is removed or renamed; every route that used to check only the old key now checks
-- `requireAnyPermission(oldKey, newKey)`, so a role holding just the old key keeps working exactly
-- as before, and a role can now also be granted just one narrow verb instead of the whole module.
--
-- Verb set deliberately varies per module, matching only routes that actually exist today:
--   department already has view/manage (kept as-is) — adds create/edit/delete (all three routes
--     exist: POST/PATCH/DELETE).
--   roles has only the one coarse `manage_roles` key — adds read (the two GET routes)/create/edit/
--     delete (all four exist).
--   forms.manage.tenant covers form-field CRUD — adds read (GET /tenant/form-definitions)/create/
--     edit (no delete key: there is no DELETE route, only archive-via-PATCH, research.md §7 of
--     spec 010 — inventing a permission nothing checks was rejected).
--   team only has one real route at all today (POST — invite/create a member; no list/edit/remove
--     route exists anywhere in this codebase) — adds only `team.create`, nothing else.
INSERT INTO "permissions" ("key", "display_name", "description", "category") VALUES
  ('department.create', 'Create Departments', 'Create new departments for a tenant.', 'department'),
  ('department.edit', 'Edit Departments', 'Rename, describe, and reassign the manager/parent of existing departments.', 'department'),
  ('department.delete', 'Delete Departments', 'Delete departments for a tenant.', 'department'),
  ('roles.read', 'View Roles', 'View the role list, their permissions, and the permission catalog for a tenant.', 'roles'),
  ('roles.create', 'Create Roles', 'Create new custom roles for a tenant.', 'roles'),
  ('roles.edit', 'Edit Roles', 'Rename and change the permission set of existing custom roles.', 'roles'),
  ('roles.delete', 'Delete Roles', 'Delete custom roles for a tenant.', 'roles'),
  ('forms.tenant.read', 'View Tenant Form Fields', 'View the list of registered form types for a tenant.', 'forms'),
  ('forms.tenant.create', 'Create Tenant Form Fields', 'Add new custom fields on any form type for a tenant.', 'forms'),
  ('forms.tenant.edit', 'Edit Tenant Form Fields', 'Edit, reorder, and archive this tenant''s own custom fields on any form type.', 'forms'),
  ('team.create', 'Create Team Members', 'Create new member accounts and assign their role.', 'settings');

-- Grants every new key to the hr_admin role template, for future reseeds/provisioning of new
-- tenants — hr_admin already holds each corresponding "manage" superset key, so this only keeps its
-- own permission checklist visually honest (every action it can actually take shows checked),
-- never a new capability on top of what it already had.
INSERT INTO "role_template_permissions" ("role_template_id", "permission_id")
SELECT rt.id, p.id
FROM "role_templates" rt
CROSS JOIN "permissions" p
WHERE rt.key = 'hr_admin'
  AND p.key IN (
    'department.create', 'department.edit', 'department.delete',
    'roles.read', 'roles.create', 'roles.edit', 'roles.delete',
    'forms.tenant.read', 'forms.tenant.create', 'forms.tenant.edit',
    'team.create'
  );

-- Backfills onto every already-live tenant role sourced from hr_admin (by source_template_id where
-- present, or by exact role name — the same combined, from-the-start approach 0031 already learned
-- from 0025/0026's two-step lesson), gated on not already holding the permission (idempotent).
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE p.key IN (
    'department.create', 'department.edit', 'department.delete',
    'roles.read', 'roles.create', 'roles.edit', 'roles.delete',
    'forms.tenant.read', 'forms.tenant.create', 'forms.tenant.edit',
    'team.create'
  )
  AND (
    r.name = 'HR/L&D Admin'
    OR r.source_template_id IN (SELECT id FROM "role_templates" WHERE key = 'hr_admin')
  )
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
