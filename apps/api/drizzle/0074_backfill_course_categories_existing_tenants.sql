-- Backfills the six default course categories for every tenant provisioned before this feature
-- shipped (mirrors 0023_backfill_tenant_auth_methods.sql's precedent of backfilling a default for
-- tenants provisioned before the feature existed) — otherwise an already-live tenant would have zero
-- categories, until an admin created one manually via course create/update's inline auto-create.
-- Idempotent: only inserts a (tenant, template) pair that doesn't already exist, so re-running this
-- migration (or a tenant that already has some categories from a partial run) is safe.
INSERT INTO "course_categories" ("tenant_id", "name", "source_template_id")
SELECT t.id, ct.name, ct.id
FROM "tenants" t
CROSS JOIN "course_category_templates" ct
WHERE NOT EXISTS (
  SELECT 1 FROM "course_categories" cc
  WHERE cc.tenant_id = t.id AND lower(cc.name) = lower(ct.name)
);
