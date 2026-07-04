-- Seeds two new permissions (research.md §7) and grants both to the `hr_admin` role template (for
-- all future provisioning) *and* retroactively to every existing tenant's already-live
-- `hr_admin`-sourced role row — mirrors 0014_seed_provision_tenant_permission.sql's precedent of
-- backfilling an already-live row rather than only affecting future provisioning. Without the
-- backfill, tenants provisioned before this migration (including manual test tenants from Spec 4's
-- own verification) would have an HR Admin who can't reach this feature's settings screens at all.
INSERT INTO "permissions" ("key", "display_name", "description", "category") VALUES
  ('manage_authentication_settings', 'Manage Authentication Settings', 'View and change which login methods are enabled for a tenant.', 'settings'),
  ('manage_team_members', 'Manage Team Members', 'Add new team members to a tenant.', 'settings');

-- Grant to the hr_admin role_template, for future reseeds/provisioning of new tenants.
INSERT INTO "role_template_permissions" ("role_template_id", "permission_id")
SELECT rt.id, p.id
FROM "role_templates" rt
CROSS JOIN "permissions" p
WHERE rt.key = 'hr_admin' AND p.key IN ('manage_authentication_settings', 'manage_team_members');

-- Also grant to every already-live tenant's hr_admin-sourced role row.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
JOIN "role_templates" rt ON rt.id = r.source_template_id
CROSS JOIN "permissions" p
WHERE rt.key = 'hr_admin' AND p.key IN ('manage_authentication_settings', 'manage_team_members');
