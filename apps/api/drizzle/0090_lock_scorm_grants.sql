-- Establishes tm_app's table privileges for this feature's four tables, mirroring
-- 0084_lock_learner_content_progress_grants.sql. Fully tenant-owned — full CRUD for the app, enforced
-- per-request by RLS (0086-0089), not by table-level grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON scorm_packages, scorm_package_items, scorm_cmi_objectives, scorm_cmi_interactions TO tm_app;
