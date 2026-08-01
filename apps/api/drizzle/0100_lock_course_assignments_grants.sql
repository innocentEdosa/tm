-- Establishes tm_app's table privileges for course_assignments, mirroring
-- 0081_lock_file_attachments_grants.sql. Fully tenant-owned — full CRUD for the app, enforced
-- per-request by RLS (0099), not by table-level grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON course_assignments TO tm_app;
