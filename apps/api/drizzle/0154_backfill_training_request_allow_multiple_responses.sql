-- Multiple form responses feature: `form_definitions.allow_multiple_responses` (0153) defaults to
-- `false` for every row, but Training Request (`training_needs_analysis`) has never enforced a
-- one-response-per-user limit — any manage.department/manage.all caller has always been able to
-- create any number of `training_needs` rows (tenant-training-needs-routes.ts has no such check).
-- Backfilling this one row to `true` keeps that existing, already-shipped behavior unchanged for
-- every current tenant now that the enforcement this migration's column enables goes live in the
-- same release — a Super Admin who explicitly wants to restrict Training Request to a single
-- response per user going forward can still flip this off later through the Form Builder.
UPDATE form_definitions SET allow_multiple_responses = true WHERE key = 'training_needs_analysis';
