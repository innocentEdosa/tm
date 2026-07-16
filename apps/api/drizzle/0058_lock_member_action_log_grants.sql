-- Establishes tm_app's table privileges for member_action_log. No RLS (platform-level, no
-- tenant_id-scoped policy — data-model.md `member_action_log`), so isolation here is enforced
-- entirely at the grant level plus the fact that every write/read path is a Super-Admin-only route.

-- Append-only log: the running server writes one row per password-reset action and could read them
-- back later (no audit-log UI in this spec). No UPDATE/DELETE grant — nothing in this codebase should
-- ever be able to edit or remove a log entry once written.
GRANT SELECT, INSERT ON member_action_log TO tm_app;
