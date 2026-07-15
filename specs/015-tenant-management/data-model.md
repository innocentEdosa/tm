# Data Model: Tenant Management

All changes live in the same shared Postgres schema every prior spec uses (shared schema + RLS
isolation model — no change to that model). Each table below states its tenant-isolation treatment
explicitly, per the constitution Quality Bar.

## Tables

### `tenants` — amended (existing table, from Tenant Provisioning Core)

Three new nullable-timestamp columns, added the same way the Add/Edit Team Member spec added
`users.archived_at`:

| Column | Type | Notes |
|---|---|---|
| `archived_at` | `timestamptz`, nullable | NULL = not archived. Set by User Story 3 (Archive); cleared by reactivation. While set, the tenant's own users cannot sign in or hold a session (FR-007; enforced in `tenant-user-context.ts`, mirroring the existing `users.archived_at` check). |
| `deletion_requested_at` | `timestamptz`, nullable | NULL = not pending deletion. Set the moment a Delete is confirmed (FR-013). While set, same access-block behavior as `archived_at`. |
| `deletion_purge_at` | `timestamptz`, nullable | Set alongside `deletion_requested_at` to `deletion_requested_at + <grace period>` (grace-period length is a deployment-config value, not hardcoded — see plan.md Assumptions carried from spec.md). The purge script (research.md §5) selects tenants where `deletion_purge_at <= now()`. |

No change to `status` (`trial`/`active`/`suspended`/`cancelled`) or its `CHECK` constraint — Downgrade
(User Story 4) writes only to this existing column (research.md §4). No change to any other existing
column.

**Precondition rule (FR-012)**: Edit and Downgrade both reject with a clear error if
`archived_at IS NOT NULL` or `deletion_requested_at IS NOT NULL` on the target row — enforced in each
action's own handler, not by a database constraint (a Super Admin's reactivate/recover action must
itself be able to write to an archived/pending-deletion row, so a blanket check constraint would be
wrong here).

**Isolation**: The existing `tenant_isolation` policy (`id = current_setting('app.tenant_id',
true)::uuid`) is left **completely unedited**. A new, additive, permissive policy is added:

```sql
CREATE POLICY "super_admin_full_access" ON "tenants"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
```

Identical shape to the already-shipped `form_fields.super_admin_full_access` policy (Custom Fields
Framework spec). Postgres OR's multiple permissive policies together, so this grants a verified
Super-Admin-context connection (`request.superAdminDb`, `app.is_super_admin` already set by
`super-admin-context.ts`) full read/write across every tenant row, without loosening
`tenant_isolation` for any ordinary tenant-scoped connection at all (research.md §8 — this is the
blocking gap this feature closes).

---

### `user_sessions` — amended (existing table, from Tenant Authentication Configuration)

No new columns — the existing `revoked_at` column (already used by both tenant-user login/logout and
Super Admin session revocation elsewhere in the codebase) is reused as-is.

**New behavior**: On Archive or Delete, this feature bulk-updates
`SET revoked_at = now() WHERE tenant_id = :tenantId AND revoked_at IS NULL` for the target tenant
(research.md §3).

**Isolation**: Same additive-policy treatment as `tenants` — `tenant_isolation` unedited, plus:

```sql
CREATE POLICY "super_admin_full_access" ON "user_sessions"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
```

Without this, the bulk-revoke `UPDATE` would silently match zero rows under `tenant_isolation` alone,
since a Super-Admin-context connection never sets `app.tenant_id` (research.md §8).

---

### `tenant_action_log` — new table, platform-level, no `tenant_id` scoping in the RLS sense

Satisfies FR-016 (log every management action) without building the audit-log UI itself (out of
scope). Same shape as the already-shipped `super_admin_sessions` table.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid`, nullable, FK → `tenants.id`, `ON DELETE SET NULL` | Which tenant the action targeted. Nullable and `SET NULL` (not `NOT NULL`/cascade) so that when the purge script (FR-015b) permanently removes a `tenants` row, the audit trail of who deleted it and when survives — same "preserve history over the referenced row" precedent as `users.invited_by`. Not used for RLS scoping (see Isolation below). |
| `super_admin_id` | `uuid`, nullable, FK → `super_admins.id`, `ON DELETE SET NULL` | Which Super Admin performed the action. Nullable/`SET NULL` for the same reason as `tenant_id`: a Super Admin account can itself be deleted later, and that must never be blocked by, or cascade-delete, this append-only log. |
| `action` | `text`, not null | One of `edit`, `archive`, `reactivate`, `downgrade`, `delete`, `delete_recover` (FR-016). Text + application-level validation, matching this codebase's established "no Postgres ENUM types" convention (data-model.md precedent, Tenant Provisioning Core). |
| `created_at` | `timestamptz`, not null, default `now()` | |

**Isolation**: No RLS policy — analogous to `super_admin_sessions`, which also has none. This table is
never queried through `request.tenantDb`; every write/read in this feature goes through
`request.superAdminDb` inside a Super-Admin-only route (research.md §6). `tm_app` is granted
`INSERT`/`SELECT` only — no `UPDATE`/`DELETE` (append-only log, mirroring the intent of
`super_admins`' deliberately no-`INSERT` grant from the other direction: this table's writes are meant
to happen from exactly one code path, the action handlers themselves, not be editable afterward).

---

## State Model (informative, not a new column)

`tenants` now has two independent binary states layered on top of the existing four-value `status`:

```text
              ┌───────────────┐   archive    ┌───────────────┐
  status: -──▶│ Not Archived  │─────────────▶│   Archived    │
 trial/active  │ (archived_at  │◀─────────────│ (archived_at  │
 /suspended/   │   IS NULL)    │  reactivate   │  IS NOT NULL) │
 cancelled     └───────────────┘               └───────────────┘
        │                                              │
        │ delete                                        │ delete
        ▼                                              ▼
┌────────────────────────┐   grace period    ┌──────────────────┐
│   Pending Deletion       │ ───elapses──────▶│  Permanently      │
│ (deletion_requested_at   │                   │  Purged (row      │
│  IS NOT NULL)            │◀──── recover ─────│  no longer exists)│
└────────────────────────┘                   └──────────────────┘
```

`status` and `archived_at`/`deletion_requested_at` are orthogonal: a tenant can be `active` and
archived at the same time (its status is preserved so reactivation restores exactly what it was);
Downgrade is blocked while either is set (FR-012), so there is never an ambiguous "what does downgrading
an archived tenant even mean" case to handle.
