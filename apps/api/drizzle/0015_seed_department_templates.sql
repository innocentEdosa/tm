-- Seeds the default department catalog (FR-006, research.md §5) — a reasonable general-company org
-- chart, not industry-specific (spec.md Assumptions on flat, non-hierarchical structure).
INSERT INTO "department_templates" ("key", "name") VALUES
  ('hr', 'Human Resources'),
  ('sales', 'Sales'),
  ('engineering', 'Engineering'),
  ('finance', 'Finance'),
  ('operations', 'Operations'),
  ('customer_support', 'Customer Support');
