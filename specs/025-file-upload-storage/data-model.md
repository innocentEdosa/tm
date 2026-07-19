# Data Model: File Upload & Storage

All tables live in the shared Postgres schema (shared schema + RLS isolation model, unchanged —
research.md §3). This spec introduces **one new table** (`file_attachments`). No existing table is
altered.

## New table: `file_attachments`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK, default random | |
| `tenant_id` | `uuid`, not null, FK → `tenants.id` | |
| `entity_type` | `text`, not null | `CHECK (entity_type IN ('content_item'))` — extended by a future migration when a second entity type is wired (research.md §3), mirroring `content_items.type`'s own extensible-enum convention |
| `entity_id` | `uuid`, not null | **No database-level FK** — deliberately polymorphic, mirrors `custom_field_values.entity_id` (research.md §3). The route layer is responsible for having already confirmed, via its own tenant-scoped fetch, that this id refers to a real entity in the caller's own tenant before creating a `file_attachments` row against it. |
| `file_name` | `text`, not null | original, client-declared file name |
| `content_type` | `text`, not null | client-declared MIME type, validated against the allowlist for `entity_type` before the row is created (research.md §7) |
| `size_bytes` | `bigint`, not null | client-declared at request time; re-verified against the real object in storage at confirm time (FR-004) |
| `storage_key` | `text`, not null, unique | the R2 object key (research.md §6): `{tenantId}/{entityType}/{entityId}/{attachmentId}/{fileName}` |
| `status` | `text`, not null, default `'pending'` | `CHECK (status IN ('pending', 'ready'))` |
| `created_by_user_id` | `uuid`, nullable, FK → `users.id`, `ON DELETE SET NULL` | |
| `created_at` / `updated_at` | `timestamptz`, not null, default now | `updated_at` set when the row transitions `pending` → `ready` |

**Constraints**:
- `entity_type` `CHECK` as above.
- `status` `CHECK` as above.
- Unique on `storage_key` — defense-in-depth (keys already include a fresh `attachmentId`, making a
  collision astronomically unlikely by construction, but a unique constraint costs nothing and matches
  this codebase's general "belt and suspenders" convention).

**Isolation**: RLS enabled + forced, standard `tenant_isolation` policy, same migration sequence as
every prior tenant table.

**Indexes**: `index("file_attachments_tenant_id_entity_type_entity_id_idx").on(tenantId, entityType,
entityId)` — backs both the per-entity list query and the bulk-delete-for-entity function (FR-009).

**Validation rules** (application layer):
- `fileName`, `contentType` required, non-blank; `sizeBytes` required, `> 0`.
- `contentType`/`sizeBytes` validated against the fixed allowlist for the target `entityType`
  (research.md §7) — rejected (`422`) before any row is created or any R2 call is made.
- The target entity (a content item, for now) must resolve via `request.tenantDb` in the caller's own
  tenant — `404` otherwise (RLS makes a cross-tenant id simply not found).
- A confirm-upload call re-verifies the object's real existence and size via `HeadObject` against R2 —
  a mismatch or missing object leaves the row `pending`, never transitions it to `ready`.

**State transitions**: `pending` → `ready`, one-directional, triggered only by a successful confirm
(FR-004). No `ready` → `pending` transition exists. No archival/soft-delete state — deletion is always
a hard delete of both the row and the underlying R2 object (FR-008).

---

## Relationships

```
tenants          1──* file_attachments   (new)
users            0..1──* file_attachments (new: created_by_user_id, ON DELETE SET NULL)
content_items    1──* file_attachments   (new, polymorphic via entity_type='content_item' + entity_id — no DB FK)
```

No change to `permissions` — this spec adds zero rows there (reuses `course.view`/`course.manage`,
research.md/spec Constitution Alignment).

## Derived concepts (not columns — computed at request time)

- **Entity's attachment list** (spec FR-006): `SELECT * FROM file_attachments WHERE tenant_id = :tenant
  AND entity_type = :type AND entity_id = :id AND status = 'ready' ORDER BY created_at` (RLS-scoped via
  `request.tenantDb`).
- **Bulk-delete for entity** (spec FR-009): `SELECT storage_key FROM file_attachments WHERE tenant_id =
  :tenant AND entity_type = :type AND entity_id = :id` → delete each object from R2 → `DELETE FROM
  file_attachments WHERE tenant_id = :tenant AND entity_type = :type AND entity_id = :id`. Exported as a
  plain function (`deleteAllAttachmentsForEntity`), not its own HTTP route (research.md §4) — intended
  for a future caller such as a modified content-item delete handler.
