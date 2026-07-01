-- Seeds the platform permission catalog (FR-001). `manage_roles` and `view_permission_catalog`
-- are included here (not just the three named in spec.md's User Story 1 prose) so User Story 3's
-- tenant-role-management endpoints and the Super Admin catalog view have a permission to check
-- against.
INSERT INTO "permissions" ("key", "display_name", "description", "category") VALUES
  ('approve_enrollment', 'Approve Enrollment', 'Approve a learner''s enrollment request into a course.', 'enrollment'),
  ('edit_content_library', 'Edit Content Library', 'Create, edit, and remove courses and content library items.', 'content'),
  ('view_department_analytics', 'View Department Analytics', 'View enrollment, completion, and engagement analytics for a department.', 'analytics'),
  ('manage_roles', 'Manage Roles', 'Rename, edit, create, and delete roles within a tenant.', 'roles'),
  ('view_permission_catalog', 'View Permission Catalog', 'View the platform-wide permission catalog and default role templates.', 'platform');
