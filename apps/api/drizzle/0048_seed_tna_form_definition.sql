-- Training Needs Analysis spec (014): registers the form type this spec's demoable flow needs,
-- mirroring 0030_seed_department_form_definition.sql. `training_needs_analysis` — the row 0030's
-- own comment anticipated ("No tna row — Training Needs Analysis has no spec yet").
INSERT INTO "form_definitions" ("key", "name", "description") VALUES
  ('training_needs_analysis', 'Training Needs Analysis', 'Department-level training and skill-gap requests.');
