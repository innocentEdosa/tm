-- Establishes tm_app's table privileges for this feature's tables, mirroring
-- 0071_lock_course_catalog_grants.sql. Both tables are fully tenant-owned (no read-only platform
-- catalog this time, unlike course_category_templates) — full CRUD for the app, enforced per-request
-- by RLS (0076-0077), not by table-level grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON course_modules, content_items TO tm_app;
