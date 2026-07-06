-- Corrective follow-up to 0025_seed_department_permissions.sql. That migration's backfill only
-- matched roles linked to the hr_admin role_template via source_template_id — but the vast majority
-- of "HR/L&D Admin"-named roles in this database (511 of 513) have a NULL source_template_id (not
-- created through seedDefaultRolesForTenant), so they were missed entirely, even though most of
-- them already carry manage_team_members/manage_authentication_settings from some other grant path.
-- Broadens the match to role name, gated on not already holding the permission (idempotent, safe to
-- rerun).
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.name = 'HR/L&D Admin'
  AND p.key IN ('department.view', 'department.manage')
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
