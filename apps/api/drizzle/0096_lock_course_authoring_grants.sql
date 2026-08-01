-- Establishes tm_app's table privileges for the two new tables added in this pass, mirroring
-- 0078_lock_course_content_grants.sql. Both are fully tenant-owned — full CRUD for the app, enforced
-- per-request by RLS (0094-0095), not by table-level grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON course_authors, course_reviews TO tm_app;