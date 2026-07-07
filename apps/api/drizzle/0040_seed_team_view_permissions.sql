-- Team Member Directory spec (012): introduces the two visibility-scoping permissions the spec
-- itself depends on — neither existed before (research.md §1 confirmed Team/Members only had
-- manage_team_members/team.create, both write-only). `team.view.all` grants org-wide visibility;
-- `team.view.department` grants department-subtree-scoped visibility (data-model.md).
INSERT INTO "permissions" ("key", "display_name", "description", "category") VALUES
  ('team.view.all', 'View All Team Members', 'View every team member in the tenant, in any department.', 'settings'),
  ('team.view.department', 'View Department Team Members', 'View team members within your own department and its sub-departments.', 'settings');

-- team.view.all -> hr_admin template (mirrors its existing org-wide access to every other module).
-- team.view.department -> manager template (mirrors Manager's existing department-scoped
-- view_department_analytics grant — a manager who can already see their department's analytics is
-- assumed to also need to see their department's member list, plan.md's own Storage note).
INSERT INTO "role_template_permissions" ("role_template_id", "permission_id")
SELECT rt.id, p.id
FROM "role_templates" rt
CROSS JOIN "permissions" p
WHERE (rt.key = 'hr_admin' AND p.key = 'team.view.all')
   OR (rt.key = 'manager' AND p.key = 'team.view.department');

-- Backfills onto every already-live tenant role sourced from hr_admin/manager (by source_template_id
-- where present, or by exact role name — the same combined, from-the-start approach 0031/0038 used),
-- gated on not already holding the permission (idempotent).
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE (
    (
      p.key = 'team.view.all'
      AND (r.name = 'HR/L&D Admin' OR r.source_template_id IN (SELECT id FROM "role_templates" WHERE key = 'hr_admin'))
    )
    OR (
      p.key = 'team.view.department'
      AND (r.name = 'Manager' OR r.source_template_id IN (SELECT id FROM "role_templates" WHERE key = 'manager'))
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
