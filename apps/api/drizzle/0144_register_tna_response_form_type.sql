-- Registers the TNA participant-response form into the Form Builder system, mirroring
-- 0139_register_business_objective_form_type.sql's own inlined 0111-backfill-body pattern. Unlike
-- Training Request/Business Objectives, the TNA response has NO system (module-hardcoded) fields at
-- all — every field below is an ordinary, tenant-editable field (is_system = false, created_by =
-- 'system' only in the sense of "seeded by a migration", not a fixed control) since none of them
-- need bespoke picker UI (no combobox, no department/user picker) the way Business Objectives'
-- Category/Owner did. Tenants can freely add/remove/reorder these via the existing, unmodified
-- Settings > Forms UI with zero new frontend code — this is the whole point of putting TNA on the
-- Form Builder rather than hand-rolling a form. Department/deadline/exercise context lives on
-- tna_exercises/tna_assignments, never as a form field here.
DO $$
DECLARE
  form_def_id uuid;
  new_version_id uuid;
  new_section_id uuid;
BEGIN
  INSERT INTO "form_definitions" ("key", "name", "description")
  VALUES (
    'tna_response',
    'Training Needs Analysis Response',
    'The form a manager or assigned participant fills out to identify training needs for their department.'
  )
  RETURNING id INTO form_def_id;

  INSERT INTO "form_fields"
    ("form_definition_id", "tenant_id", "field_key", "label", "field_type", "is_required", "display_order", "created_by", "is_system")
  VALUES
    (form_def_id, NULL, 'current_challenges', 'Current Challenges', 'textarea', false, 0, 'system', false),
    (form_def_id, NULL, 'skill_gaps', 'Identified Skill Gaps', 'textarea', true, 10, 'system', false),
    (form_def_id, NULL, 'required_skills', 'Required Skills', 'textarea', false, 20, 'system', false),
    (form_def_id, NULL, 'recommended_training', 'Recommended Training', 'textarea', false, 30, 'system', false),
    (form_def_id, NULL, 'priority', 'Priority', 'select', true, 40, 'system', false),
    (form_def_id, NULL, 'employees_affected', 'Number of Employees Affected', 'number', false, 50, 'system', false),
    (form_def_id, NULL, 'business_impact', 'Business Impact', 'textarea', false, 60, 'system', false),
    (form_def_id, NULL, 'recommended_timeframe', 'Recommended Timeframe', 'text', false, 70, 'system', false),
    (form_def_id, NULL, 'additional_comments', 'Additional Comments', 'textarea', false, 80, 'system', false);

  UPDATE "form_fields" SET options = '["Low", "Medium", "High"]'
  WHERE form_definition_id = form_def_id AND field_key = 'priority';

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
