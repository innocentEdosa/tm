-- Training Needs Analysis approval follow-up: `tna.approve` — a governance action deliberately
-- separate from `tna.manage.*` (0050), so a tenant can grant approval authority to a role without
-- also granting edit/delete rights, or vice versa. Org-wide only (no department-scoped variant,
-- unlike view/manage) — approval is a centralized sign-off, mirroring how `tna.view.all`/
-- `tna.manage.all` are the org-wide tier. Granted to `hr_admin` by default; a tenant can extend it
-- to other roles via the existing Roles Management UI (spec 011) like any other permission.
INSERT INTO "permissions" ("key", "display_name", "description", "category") VALUES
  ('tna.approve', 'Approve Training Needs', 'Approve a submitted training-need entry, in any department.', 'learning');

INSERT INTO "role_template_permissions" ("role_template_id", "permission_id")
SELECT rt.id, p.id
FROM "role_templates" rt
CROSS JOIN "permissions" p
WHERE rt.key = 'hr_admin' AND p.key = 'tna.approve';

-- Backfills onto every already-live tenant's hr_admin-sourced role (by source_template_id or by
-- exact role name, matching 0050's combined approach), gated on not already holding the permission
-- (idempotent).
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE p.key = 'tna.approve'
  AND (r.name = 'HR/L&D Admin' OR r.source_template_id IN (SELECT id FROM "role_templates" WHERE key = 'hr_admin'))
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
