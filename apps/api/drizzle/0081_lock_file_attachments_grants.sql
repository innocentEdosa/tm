-- Establishes tm_app's table privileges for this feature's table, mirroring
-- 0071_lock_course_catalog_grants.sql. Fully tenant-owned — full CRUD for the app, enforced
-- per-request by RLS (0080), not by table-level grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON file_attachments TO tm_app;
