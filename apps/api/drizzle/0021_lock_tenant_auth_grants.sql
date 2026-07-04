-- `tm_app` grants for the three new tables (Tenant Authentication Configuration spec): full CRUD,
-- same as every other tenant-scoped table this role already manages (roles, departments, users).
-- `users`' existing grant (0012_lock_department_catalog_grants.sql) already covers this migration's
-- new columns on that table — no grant change needed there.
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_auth_methods" TO tm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "user_sessions" TO tm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "password_reset_tokens" TO tm_app;
