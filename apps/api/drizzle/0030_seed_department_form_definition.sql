-- Seeds the one form_definitions row this spec's demoable flow needs (research.md §3). No `tna` row
-- — Training Needs Analysis has no spec yet, and seeding a form type with no real consuming module
-- would contradict the spec's own framing of form types as registered "when a module ships."
INSERT INTO "form_definitions" ("key", "name", "description") VALUES
  ('department', 'Department', 'Departments in your organization''s structure.');
