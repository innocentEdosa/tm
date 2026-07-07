-- Corrective migration, discovered while building the Roles Management UI (spec 011): its
-- system-role guard and "isSystem" flag rely entirely on `roles.source_template_id IS NOT NULL`,
-- but a live query against this database found the exact same class of gap already documented for
-- permission grants (0025/0026, 0031) — the vast majority of existing "HR/L&D Admin" rows (707 of
-- 711) and a smaller fraction of "Manager" rows (65 of 776) have a NULL `source_template_id`,
-- meaning they were never created via `seedDefaultRolesForTenant` and are therefore currently
-- indistinguishable from a genuine custom role, even though they are a tenant's actual default
-- role. "Employee/Learner" already has zero gap (0 of 711). Backfills by exact role name match
-- against the current `role_templates.name` — the same reasoning 0026 already established: a
-- tenant cannot have a second role sharing the exact same name (unique per tenant), so an exact
-- name match to a template's own name is a safe, high-confidence signal.
--
-- Deliberately excludes the 111 rows literally named "Employee" (not "Employee/Learner") — that
-- name does not exactly match any current role_templates row, so backfilling it would be a
-- separate, lower-confidence judgment call (possibly pre-rename legacy data, possibly genuine
-- tenant-chosen custom roles) outside this migration's conservative, exact-match-only scope.
UPDATE "roles" r
SET source_template_id = rt.id
FROM "role_templates" rt
WHERE r.tenant_id IS NOT NULL
  AND r.source_template_id IS NULL
  AND r.name = rt.name
  AND rt.is_platform_only = false;
