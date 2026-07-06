-- Placeholder rows for Department's fixed, module-hardcoded fields — global (tenant_id NULL),
-- immutable, existing purely so each has a stable id to participate in the unified,
-- tenant-overridable field order (form_field_order_overrides) alongside real custom fields.
-- fieldType/isRequired here are nominal labels only; department-settings-client.tsx always renders
-- its own real, hardcoded control for these, matched by field_key.
INSERT INTO "form_fields"
  ("form_definition_id", "tenant_id", "field_key", "label", "field_type", "is_required", "display_order", "created_by", "is_system")
SELECT id, NULL, v.field_key, v.label, v.field_type, v.is_required, v.display_order, 'system', true
FROM "form_definitions",
  (VALUES
    ('name', 'Name', 'text', true, 0),
    ('parent_department_id', 'Parent department', 'text', false, 10),
    ('description', 'Description', 'textarea', false, 20),
    ('manager_id', 'Manager', 'text', false, 30),
    ('assistant_manager_id', 'Assistant Manager', 'text', false, 40),
    ('status', 'Status', 'text', false, 50)
  ) AS v(field_key, label, field_type, is_required, display_order)
WHERE "form_definitions"."key" = 'department';
