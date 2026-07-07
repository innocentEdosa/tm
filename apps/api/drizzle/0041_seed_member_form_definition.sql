-- Team Member Directory spec (012): registers the "member" form type so tenants can configure
-- custom fields against it via the existing Custom Fields Framework, mirroring
-- 0030_seed_department_form_definition.sql exactly (research.md §4 — the framework is already fully
-- generic; this is the only change needed to make it a second consumer).
INSERT INTO "form_definitions" ("key", "name", "description") VALUES
  ('member', 'Team Member', 'Members of your organization.');
