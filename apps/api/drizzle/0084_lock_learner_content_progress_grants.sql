-- Establishes tm_app's table privileges for this feature's table, mirroring
-- 0081_lock_file_attachments_grants.sql. Fully tenant-owned — full CRUD for the app, enforced
-- per-request by RLS (0083), not by table-level grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON learner_content_progress TO tm_app;
