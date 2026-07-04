-- Backfills the default `email_password` auth method for every tenant provisioned before this
-- migration (research.md §7's sibling backfill) — otherwise an existing tenant would have zero
-- enabled login methods, violating spec FR-006, until an HR Admin manually enables one.
INSERT INTO "tenant_auth_methods" ("tenant_id", "method")
SELECT id, 'email_password' FROM "tenants"
ON CONFLICT ("tenant_id", "method") DO NOTHING;
