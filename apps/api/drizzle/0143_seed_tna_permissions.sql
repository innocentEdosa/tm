-- Training Needs Analysis (the real, HR-initiated exercise — distinct from Training Request,
-- formerly named "Training Needs Analysis" itself before spec 020's rename freed this name up).
-- `tna.manage` grants create/edit/start/close/review/commit + full visibility into all exercises
-- and submissions — a single, org-wide permission (no `.all`/`.department` split like Training
-- Request's own permissions): unlike Training Request, TNA authoring is inherently an HR-admin
-- function, never department-scoped self-service. `tna.view` is read-only parity for a reporting
-- role that shouldn't manage exercises. Neither permission gates a participant completing their own
-- assigned TNA — that's assignment-based visibility (tna_assignments.user_id = caller), the same
-- "assignment implies visibility, no permission needed" precedent "My Learning" already uses for
-- course access, not a permission check.
INSERT INTO "permissions" ("key", "display_name", "description", "category") VALUES
  ('tna.manage', 'Manage Training Needs Analysis', 'Create, start, close, review, and commit Training Needs Analysis exercises; view all submissions.', 'learning'),
  ('tna.view', 'View Training Needs Analysis', 'View Training Needs Analysis exercises, progress, and submissions.', 'learning');

-- tna.manage + tna.view -> hr_admin template (mirrors its existing org-wide access to every other
-- module, same as 0050_seed_tna_permissions.sql's own hr_admin grant for Training Request).
INSERT INTO "role_template_permissions" ("role_template_id", "permission_id")
SELECT rt.id, p.id
FROM "role_templates" rt
CROSS JOIN "permissions" p
WHERE rt.key = 'hr_admin' AND p.key IN ('tna.manage', 'tna.view');

-- Backfills onto every already-live tenant role sourced from hr_admin (by source_template_id where
-- present, or by exact role name — matching 0050's combined, from-the-start approach), gated on not
-- already holding the permission (idempotent).
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE p.key IN ('tna.manage', 'tna.view')
  AND (r.name = 'HR/L&D Admin' OR r.source_template_id IN (SELECT id FROM "role_templates" WHERE key = 'hr_admin'))
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
