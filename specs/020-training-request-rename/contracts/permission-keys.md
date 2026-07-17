# Contract: Permission Keys

This documents the permission-key contract change for every internal caller (route preHandlers,
role-management UI, tests) that checks or displays one of the five keys gating the Training Request
feature. This is an internal platform contract (not a public/external API) — "consumers" here means
other code in this monorepo and the tenant Roles Management UI (Spec 011).

## Before → After

| Capability | Old key | New key |
|---|---|---|
| View every entry, any department | `tna.view.all` | `training_request.view.all` |
| View entries in own department + sub-departments | `tna.view.department` | `training_request.view.department` |
| Create/edit/delete any entry, any department | `tna.manage.all` | `training_request.manage.all` |
| Create/edit own-department entries; delete own drafts | `tna.manage.department` | `training_request.manage.department` |
| Approve a submitted entry, any department | `tna.approve` | `training_request.approve` |

## Guarantees

- **What each key gates is unchanged.** Only the string identifier changes; the capability behind
  it (which rows/actions it authorizes) is identical before and after.
- **No caller needs a code branch for "old or new" during rollout.** The database `UPDATE` and the
  code that checks the new string deploy together, atomically, in the same release (research.md
  §5) — there is no supported intermediate state where one side uses the old key and the other the
  new one. Deploy order for a single-instance rollout: migration first, then the code deploy that
  reads the new key (or both in one deploy step if the platform doesn't separate migration/app
  deploys) — never the reverse, which would have code checking a key string that doesn't exist yet.
- **Every existing grant survives.** Any role — tenant-created or template-sourced — that held one
  of the old keys holds the exact same capability under the new key immediately after the
  migration, with no re-granting action required by any tenant admin (spec FR-005, SC-002).
- **No new key is introduced beyond the 1:1 rename set above.** This feature does not add, split,
  or merge any permission.

## Known callers to update (non-exhaustive contract-relevant list; full file list in plan.md)

- `apps/api/src/training-needs/tenant-training-needs-routes.ts` — `requirePermission`/
  `requireAnyPermission`/`hasPermission` call sites (~15 literal occurrences of the old keys).
- `apps/web/app/(dashboard-shell)/layout.tsx` — `session.permissions.includes(...)` nav-gating
  checks (`canAccessTna` and its five `.includes()` calls).
- `apps/api/drizzle/0064_rename_tna_permissions_to_training_request.sql` — the migration that
  performs the actual `key` rename (source of truth for old→new mapping).
