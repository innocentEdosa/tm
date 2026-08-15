-- Business Objectives (Strategy nav): introduces the two permissions the feature depends on — none
-- existed before. Unlike training_needs/training_request, objectives are tenant-wide (no department
-- column on the row), so there's no `.all`/`.department` scope split — just `view` (read the list/
-- detail) and `manage` (create/edit/delete). Mirrors 0050_seed_tna_permissions.sql's structure.
INSERT INTO "permissions" ("key", "display_name", "description", "category") VALUES
  ('business_objective.view', 'View Business Objectives', 'View business objectives and their progress.', 'learning'),
  ('business_objective.manage', 'Manage Business Objectives', 'Create, edit, and delete business objectives.', 'learning');

-- business_objective.view + business_objective.manage -> hr_admin template (mirrors its existing
-- org-wide access to every other module). business_objective.view -> manager template (managers can
-- see company objectives but not edit them, mirroring Manager's existing read-only grants elsewhere).
INSERT INTO "role_template_permissions" ("role_template_id", "permission_id")
SELECT rt.id, p.id
FROM "role_templates" rt
CROSS JOIN "permissions" p
WHERE (rt.key = 'hr_admin' AND p.key IN ('business_objective.view', 'business_objective.manage'))
   OR (rt.key = 'manager' AND p.key = 'business_objective.view');

-- Backfills onto every already-live tenant role sourced from hr_admin/manager (by source_template_id
-- where present, or by exact role name — matching 0050's combined, from-the-start approach), gated
-- on not already holding the permission (idempotent).
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE (
    (
      p.key IN ('business_objective.view', 'business_objective.manage')
      AND (r.name = 'HR/L&D Admin' OR r.source_template_id IN (SELECT id FROM "role_templates" WHERE key = 'hr_admin'))
    )
    OR (
      p.key = 'business_objective.view'
      AND (r.name = 'Manager' OR r.source_template_id IN (SELECT id FROM "role_templates" WHERE key = 'manager'))
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
