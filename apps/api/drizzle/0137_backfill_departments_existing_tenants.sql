-- Backfills the six default departments (department_templates) for every tenant provisioned before
-- this feature shipped — mirrors 0074_backfill_course_categories_existing_tenants.sql's precedent,
-- which department seeding itself never got despite `seedDefaultDepartmentsForTenant`
-- (provisioning/seed-default-departments.ts) already existing for brand-new tenants at provisioning
-- time. Without this, a tenant provisioned before department seeding was wired up has zero
-- departments — no owner/manager/team picker anywhere in the app has anything to offer until an
-- admin creates one by hand. Idempotent: only inserts a (tenant, name) pair that doesn't already
-- exist, case-insensitively — same guard as `departments_tenant_id_name_unique` — so this is safe to
-- re-run.
INSERT INTO "departments" ("tenant_id", "name", "source_template_id")
SELECT t.id, dt.name, dt.id
FROM "tenants" t
CROSS JOIN "department_templates" dt
WHERE NOT EXISTS (
  SELECT 1 FROM "departments" d
  WHERE d.tenant_id = t.id AND lower(d.name) = lower(dt.name)
);
