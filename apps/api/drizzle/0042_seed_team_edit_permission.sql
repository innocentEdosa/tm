-- Add/Edit Team Member spec (013): introduces the org-wide-only team.edit permission the new
-- PATCH /tenant/team/:userId route depends on (Clarifications, 2026-07-08 — no department-scoped
-- edit tier; Manager gets no grant here, since Manager holds no team-management permission today).
INSERT INTO "permissions" ("key", "display_name", "description", "category") VALUES
  ('team.edit', 'Edit Team Members', 'Edit an existing team member''s role, department, and profile details.', 'settings');

-- Granted to the HR/L&D Admin template only, mirroring 0040's own pattern.
INSERT INTO "role_template_permissions" ("role_template_id", "permission_id")
SELECT rt.id, p.id
FROM "role_templates" rt
CROSS JOIN "permissions" p
WHERE rt.key = 'hr_admin' AND p.key = 'team.edit';

-- Backfilled onto every already-live tenant's HR/L&D Admin-sourced role (matched by
-- source_template_id where present, or by exact role name — the same combined approach 0040 used),
-- gated on not already holding the permission (idempotent).
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE p.key = 'team.edit'
  AND (r.name = 'HR/L&D Admin' OR r.source_template_id IN (SELECT id FROM "role_templates" WHERE key = 'hr_admin'))
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
