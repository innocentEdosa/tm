-- Data-only follow-up to 0139_register_business_objective_form_type.sql (no schema change, so no
-- new snapshot — mirrors 0136/0139's own precedent for a data-only migration). Business Objective's
-- form now calls its Title field "Objective" (not "Objective Title") and its Category field "Focus"
-- (not "Category"); these `form_fields.label` values are nominal/documentation-only for these system
-- fields (business-objective-form.tsx always renders its own hardcoded label, matched by
-- `field_key`), but are kept in sync so any admin-facing field-order screen reads correctly. Also
-- flips `is_required` to false for `category` and `metric_name` — only Objective (`title`), Owner
-- (`owner_department_id`), and Target Completion Date (`due_date`) are actually required now.
UPDATE "form_fields"
SET label = 'Objective', updated_at = now()
WHERE "tenant_id" IS NULL AND "is_system" = true AND "field_key" = 'title'
  AND "form_definition_id" = (SELECT id FROM "form_definitions" WHERE "key" = 'business_objective');

UPDATE "form_fields"
SET label = 'Focus', is_required = false, updated_at = now()
WHERE "tenant_id" IS NULL AND "is_system" = true AND "field_key" = 'category'
  AND "form_definition_id" = (SELECT id FROM "form_definitions" WHERE "key" = 'business_objective');

UPDATE "form_fields"
SET is_required = false, updated_at = now()
WHERE "tenant_id" IS NULL AND "is_system" = true AND "field_key" IN ('priority', 'metric_name')
  AND "form_definition_id" = (SELECT id FROM "form_definitions" WHERE "key" = 'business_objective');
