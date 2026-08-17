-- Establishes tm_app's table privileges for the three TNA tables, mirroring
-- 0047_lock_training_needs_grants.sql. Tenant-scoped tables: full CRUD for the app, enforced
-- per-request by RLS (0141), not by table-level grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON tna_exercises, tna_exercise_targets, tna_assignments TO tm_app;
