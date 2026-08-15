-- Backfills the default business-objective categories for every tenant provisioned before this
-- feature shipped (mirrors 0074_backfill_course_categories_existing_tenants.sql's precedent) —
-- otherwise an already-live tenant would see an empty category combobox until someone typed a new
-- one in manually. No templates table here (unlike course_category_templates) — the default names
-- are a hardcoded VALUES list, matching provisioning/seed-default-business-objective-categories.ts.
-- Idempotent: only inserts a (tenant, name) pair that doesn't already exist, case-insensitively —
-- same guard as `business_objective_categories_tenant_id_name_unique` — so this is safe to re-run.
INSERT INTO "business_objective_categories" ("tenant_id", "name")
SELECT t.id, v.name
FROM "tenants" t
CROSS JOIN (VALUES
  ('Growth'), ('Revenue'), ('Operations'), ('Customer'), ('Product'), ('People'), ('Financial'), ('Other')
) AS v(name)
WHERE NOT EXISTS (
  SELECT 1 FROM "business_objective_categories" boc
  WHERE boc.tenant_id = t.id AND lower(boc.name) = lower(v.name)
);
