-- Business Objectives, broadened: per explicit product direction, this feature should be active on
-- every tenant out of the box (unlike training_needs/TNA's narrower hr_admin/manager-only rollout),
-- rather than requiring each tenant to opt in role-by-role first. Grants business_objective.view +
-- business_objective.manage to every role template (including employee/super_admin, not just
-- hr_admin/manager as 0130 originally scoped it), and backfills both permissions onto every
-- already-existing role in every tenant unconditionally — not just roles sourced from hr_admin/
-- manager — so this works immediately regardless of how a given tenant has named/customized its
-- roles. A tenant can still narrow this later through its own Roles settings (Manage Roles), same
-- as any other permission.
INSERT INTO "role_template_permissions" ("role_template_id", "permission_id")
SELECT rt.id, p.id
FROM "role_templates" rt
CROSS JOIN "permissions" p
WHERE p.key IN ('business_objective.view', 'business_objective.manage')
  AND NOT EXISTS (
    SELECT 1 FROM "role_template_permissions" rtp
    WHERE rtp.role_template_id = rt.id AND rtp.permission_id = p.id
  );

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE p.key IN ('business_objective.view', 'business_objective.manage')
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
