-- Training Needs Analysis spec (014): introduces the four permissions the spec itself depends on —
-- none existed before. `tna.view.all`/`tna.manage.all` grant org-wide visibility/management;
-- `tna.view.department`/`tna.manage.department` grant department-subtree-scoped visibility/
-- management (data-model.md). Mirrors 0040_seed_team_view_permissions.sql's structure exactly.
INSERT INTO "permissions" ("key", "display_name", "description", "category") VALUES
  ('tna.view.all', 'View All Training Needs', 'View every training-need entry in the tenant, in any department.', 'learning'),
  ('tna.view.department', 'View Department Training Needs', 'View training-need entries within your own department and its sub-departments.', 'learning'),
  ('tna.manage.all', 'Manage All Training Needs', 'Create, edit, and delete training-need entries in any department.', 'learning'),
  ('tna.manage.department', 'Manage Department Training Needs', 'Create and edit training-need entries within your own department and its sub-departments; delete only your own drafts.', 'learning');

-- tna.view.all + tna.manage.all -> hr_admin template (mirrors its existing org-wide access to every
-- other module). tna.view.department + tna.manage.department -> manager template (mirrors
-- Manager's existing team.view.department grant).
INSERT INTO "role_template_permissions" ("role_template_id", "permission_id")
SELECT rt.id, p.id
FROM "role_templates" rt
CROSS JOIN "permissions" p
WHERE (rt.key = 'hr_admin' AND p.key IN ('tna.view.all', 'tna.manage.all'))
   OR (rt.key = 'manager' AND p.key IN ('tna.view.department', 'tna.manage.department'));

-- Backfills onto every already-live tenant role sourced from hr_admin/manager (by source_template_id
-- where present, or by exact role name — matching 0040's combined, from-the-start approach), gated
-- on not already holding the permission (idempotent).
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE (
    (
      p.key IN ('tna.view.all', 'tna.manage.all')
      AND (r.name = 'HR/L&D Admin' OR r.source_template_id IN (SELECT id FROM "role_templates" WHERE key = 'hr_admin'))
    )
    OR (
      p.key IN ('tna.view.department', 'tna.manage.department')
      AND (r.name = 'Manager' OR r.source_template_id IN (SELECT id FROM "role_templates" WHERE key = 'manager'))
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
