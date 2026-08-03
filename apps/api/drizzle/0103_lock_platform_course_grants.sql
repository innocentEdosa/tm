-- Establishes tm_app's table privileges for this feature's five new tables, mirroring
-- 0078_lock_course_content_grants.sql. The four platform_* tables have no RLS at all (no tenant_id —
-- protection is requireSuperAdminSession at the route layer only, spec 029 plan.md Constitution
-- Check); marketplace_selections is fully tenant-owned, enforced per-request by RLS (0102), not by
-- table-level grants — same reasoning as course_modules/content_items had no read-only catalog split.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  platform_courses,
  platform_course_modules,
  platform_course_content_items,
  platform_file_attachments,
  marketplace_selections
TO tm_app;
