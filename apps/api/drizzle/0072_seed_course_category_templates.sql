-- Seeds the default course-category catalog (spec Clarifications/FR-001a) — the six categories every
-- tenant's course_categories is seeded from at provisioning (seed-default-course-categories.ts).
INSERT INTO "course_category_templates" ("key", "name") VALUES
  ('leadership', 'Leadership'),
  ('compliance', 'Compliance'),
  ('technical', 'Technical'),
  ('soft_skills', 'Soft Skills'),
  ('onboarding', 'Onboarding'),
  ('other', 'Other');
