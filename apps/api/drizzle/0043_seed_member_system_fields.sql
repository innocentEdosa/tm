-- Placeholder rows for the Add/Edit Team Member form's fixed, module-hardcoded fields — global
-- (tenant_id NULL), immutable, existing purely so each has a stable id to participate in the
-- unified, tenant-overridable field order (form_field_order_overrides) and so the generic Forms
-- settings screen's "live preview" renders them alongside a tenant's own custom fields, mirroring
-- 0036_seed_department_system_fields.sql exactly. fieldType/isRequired here are nominal labels
-- only — team-settings-client.tsx always renders its own real, hardcoded control for these,
-- matched by field_key.
INSERT INTO "form_fields"
  ("form_definition_id", "tenant_id", "field_key", "label", "field_type", "is_required", "display_order", "created_by", "is_system")
SELECT id, NULL, v.field_key, v.label, v.field_type, v.is_required, v.display_order, 'system', true
FROM "form_definitions",
  (VALUES
    ('full_name', 'Full name', 'text', true, 0),
    ('email', 'Email', 'text', true, 10),
    ('role_id', 'Role', 'text', true, 20),
    ('department_id', 'Department', 'text', false, 30)
  ) AS v(field_key, label, field_type, is_required, display_order)
WHERE "form_definitions"."key" = 'member';
