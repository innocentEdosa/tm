-- Registers Business Objectives into the Form Builder system (Form Builder spec 033), mirroring
-- 0048_seed_tna_form_definition.sql + 0049_seed_tna_system_fields.sql exactly for the definition
-- and its ten fixed, module-hardcoded fields (business-objective-form.tsx always renders its own
-- real control for each of these, matched by field_key — fieldType/isRequired here are nominal
-- labels only, same convention as TNA's own system fields). Since 0111_backfill_form_builder_versions
-- already ran (and only backfills definitions with active_version_id IS NULL that existed *at that
-- time*), a definition created now must get its own version/section here too — this migration
-- inlines that same backfill body (DO block) for just this one new definition, rather than relying
-- on 0111 running again.
DO $$
DECLARE
  form_def_id uuid;
  new_version_id uuid;
  new_section_id uuid;
BEGIN
  INSERT INTO "form_definitions" ("key", "name", "description")
  VALUES (
    'business_objective',
    'Business Objective',
    'Company-level strategic goals, their owners, and progress toward target.'
  )
  RETURNING id INTO form_def_id;

  INSERT INTO "form_fields"
    ("form_definition_id", "tenant_id", "field_key", "label", "field_type", "is_required", "display_order", "layout", "created_by", "is_system")
  VALUES
    (form_def_id, NULL, 'title', 'Objective Title', 'text', true, 0, '{"colSpan": 12}', 'system', true),
    (form_def_id, NULL, 'category', 'Category', 'text', true, 10, '{"colSpan": 12}', 'system', true),
    (form_def_id, NULL, 'description', 'Detailed Description', 'textarea', false, 20, '{"colSpan": 12}', 'system', true),
    (form_def_id, NULL, 'owner_department_id', 'Owner', 'text', true, 30, '{"colSpan": 12}', 'system', true),
    (form_def_id, NULL, 'due_date', 'Target Completion Date', 'date', true, 40, '{"colSpan": 6}', 'system', true),
    (form_def_id, NULL, 'priority', 'Priority Level', 'select', true, 50, '{"colSpan": 6}', 'system', true),
    (form_def_id, NULL, 'metric_name', 'Success Metrics / KPIs', 'text', true, 60, '{"colSpan": 12}', 'system', true),
    (form_def_id, NULL, 'baseline_value', 'Baseline Value', 'number', false, 70, '{"colSpan": 6}', 'system', true),
    (form_def_id, NULL, 'target_value', 'Target Value', 'number', false, 80, '{"colSpan": 6}', 'system', true),
    (form_def_id, NULL, 'status', 'Status', 'select', false, 90, '{"colSpan": 12}', 'system', true);

  INSERT INTO "form_versions" ("form_definition_id", "version_number", "status", "published_at")
  VALUES (form_def_id, 1, 'published', now())
  RETURNING id INTO new_version_id;

  INSERT INTO "form_sections" ("form_definition_id", "form_version_id", "form_step_id", "key", "title", "display_order")
  VALUES (form_def_id, new_version_id, NULL, 'general', 'General', 0)
  RETURNING id INTO new_section_id;

  UPDATE "form_definitions"
  SET active_version_id = new_version_id, updated_at = now()
  WHERE id = form_def_id;

  UPDATE "form_fields"
  SET form_version_id = new_version_id, form_section_id = new_section_id
  WHERE form_definition_id = form_def_id AND tenant_id IS NULL;
END $$;
