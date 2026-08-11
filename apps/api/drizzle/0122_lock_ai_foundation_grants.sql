-- Establishes tm_app's table privileges for the AI Foundation's three tables, mirroring
-- 0047_lock_training_needs_grants.sql. All tenant-scoped: full CRUD for the app, enforced
-- per-request by RLS (0121), not by table-level grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_conversations TO tm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_messages TO tm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_tool_executions TO tm_app;