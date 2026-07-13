-- Placeholder rows for TNA's fixed, module-hardcoded fields — global (tenant_id NULL), immutable,
-- existing purely so each has a stable id to participate in the unified, tenant-overridable field
-- order (form_field_order_overrides) alongside real tenant custom fields. Mirrors
-- 0036_seed_department_system_fields.sql. fieldType/isRequired here are nominal labels only;
-- training-needs-client.tsx always renders its own real, hardcoded control for these, matched by
-- field_key (research.md §5). No global (non-system) fields are seeded — per the spec's
-- Clarification session, everything beyond these four is added per-tenant via Settings > Forms.
INSERT INTO "form_fields"
  ("form_definition_id", "tenant_id", "field_key", "label", "field_type", "is_required", "display_order", "created_by", "is_system")
SELECT id, NULL, v.field_key, v.label, v.field_type, v.is_required, v.display_order, 'system', true
FROM "form_definitions",
  (VALUES
    ('title', 'Title', 'text', true, 0),
    ('priority', 'Priority', 'select', true, 10),
    ('department_id', 'Department', 'text', true, 20),
    ('status', 'Status', 'text', false, 30)
  ) AS v(field_key, label, field_type, is_required, display_order)
WHERE "form_definitions"."key" = 'training_needs_analysis';
