-- Seeds the `provision_tenant` permission (research.md §7) and grants it only to the platform
-- Super Admin role — provisioning is sales-assisted for this milestone (spec.md Clarifications), so
-- only internal staff holding the platform Super Admin role may call POST /provisioning/tenants.
-- Only touches Spec 1's existing tables (permissions, role_template_permissions, role_permissions,
-- roles) — no dependency on this feature's new tables.
INSERT INTO "permissions" ("key", "display_name", "description", "category") VALUES
  ('provision_tenant', 'Provision Tenant', 'Onboard a new company (tenant) onto the platform.', 'platform');

-- Grant to the super_admin role_template, for future reseeds of a fresh database.
INSERT INTO "role_template_permissions" ("role_template_id", "permission_id")
SELECT rt.id, p.id
FROM "role_templates" rt
CROSS JOIN "permissions" p
WHERE rt.key = 'super_admin' AND p.key = 'provision_tenant';

-- Grant directly to the already-live platform Super Admin role row (seeded once by
-- 0007_seed_super_admin_role.sql, before this permission existed) — mirrors how 0006/0007 seeded
-- together.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
JOIN "role_templates" rt ON rt.id = r.source_template_id
CROSS JOIN "permissions" p
WHERE r.tenant_id IS NULL AND rt.key = 'super_admin' AND p.key = 'provision_tenant';
