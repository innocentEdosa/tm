-- Training Request Rename (spec 020): relabels the five permissions Feature 014 introduced
-- (0050_seed_tna_permissions.sql, 0052_seed_tna_approve_permission.sql) from their `tna.*` keys to
-- `training_request.*`. This is an in-place UPDATE of the `key`/`display_name`/`description`
-- columns only — `role_permissions.permission_id` and `role_template_permissions.permission_id`
-- both reference `permissions.id` (a stable uuid), never the `key` string, so every existing
-- tenant role's grant is untouched: same row, same id, only the label changes (spec FR-005,
-- research.md §5). No row is deleted or reinserted.
UPDATE "permissions" SET
  "key" = 'training_request.view.all',
  "display_name" = 'View All Training Requests',
  "description" = 'View every training-request entry in the tenant, in any department.'
WHERE "key" = 'tna.view.all';

UPDATE "permissions" SET
  "key" = 'training_request.view.department',
  "display_name" = 'View Department Training Requests',
  "description" = 'View training-request entries within your own department and its sub-departments.'
WHERE "key" = 'tna.view.department';

UPDATE "permissions" SET
  "key" = 'training_request.manage.all',
  "display_name" = 'Manage All Training Requests',
  "description" = 'Create, edit, and delete training-request entries in any department.'
WHERE "key" = 'tna.manage.all';

UPDATE "permissions" SET
  "key" = 'training_request.manage.department',
  "display_name" = 'Manage Department Training Requests',
  "description" = 'Create and edit training-request entries within your own department and its sub-departments; delete only your own drafts.'
WHERE "key" = 'tna.manage.department';

UPDATE "permissions" SET
  "key" = 'training_request.approve',
  "display_name" = 'Approve Training Requests',
  "description" = 'Approve a submitted training-request entry, in any department.'
WHERE "key" = 'tna.approve';
