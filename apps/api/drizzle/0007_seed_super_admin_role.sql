-- Seeds the single platform-level Super Admin role (roles.tenant_id = NULL) — not per-tenant,
-- per research.md §4. Copies from the `super_admin` role_template exactly once.
INSERT INTO "roles" ("tenant_id", "name", "description", "source_template_id")
SELECT NULL, rt.name, rt.description, rt.id
FROM "role_templates" rt
WHERE rt.key = 'super_admin';

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, rtp.permission_id
FROM "roles" r
JOIN "role_templates" rt ON rt.id = r.source_template_id
JOIN "role_template_permissions" rtp ON rtp.role_template_id = rt.id
WHERE r.tenant_id IS NULL AND rt.key = 'super_admin';

