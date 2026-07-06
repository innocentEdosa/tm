# Data Model: Extensible Custom Fields Framework

All tables live in the shared Postgres schema (shared schema + RLS isolation model, per constitution
default). This spec introduces **three new tables** — no existing table is altered.

## Table: `form_definitions` — platform-global, no `tenant_id`

The catalog of developer-registered form types (spec FR-001, FR-013). One row seeded this spec:
`department`.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK | |
| `key` | `text`, unique, not null | Stable identifier, e.g. `department`. Matches the consuming module's own registration — never runtime-writable. |
| `name` | `text`, not null | Display name shown in the Settings > Forms list, e.g. "Department". |
| `description` | `text`, not null | |
| `created_at` | `timestamptz`, not null, default `now()` | |

**Isolation**: RLS not applicable (no `tenant_id`). Locked at the Postgres grant level — the
application's runtime DB role has `SELECT` only; `INSERT`/`UPDATE`/`DELETE` are granted only to the
migration role (research.md §3), mirroring `permissions`/`department_templates` exactly. No route of
any kind — tenant or Super Admin — can create, rename, or delete a row.

---

## Table: `form_fields` — dual-visibility: global (`tenant_id IS NULL`) or tenant-owned

A single field attached to a form type — either a Super-Admin-authored global default or one tenant's
own addition (spec FR-002/FR-003).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK | |
| `form_definition_id` | `uuid`, not null, FK → `form_definitions.id`, `ON DELETE RESTRICT` | |
| `tenant_id` | `uuid`, nullable, FK → `tenants.id`, `ON DELETE RESTRICT` | `NULL` = global default (Super-Admin-authored); non-null = this tenant's own addition. |
| `field_key` | `text`, not null | Stable per-field identifier; auto-suggested from `label` (research.md §6), editable at creation. |
| `label` | `text`, not null | |
| `field_type` | `text`, not null | `CHECK (field_type IN ('text','textarea','number','date','select','multiselect'))`, mirroring the existing `tenants.status`/`departments.status` `CHECK` convention. |
| `options` | `jsonb`, nullable | Array of plain strings; used only when `field_type` is `select`/`multiselect` (research.md §6). |
| `is_required` | `boolean`, not null, default `false` | |
| `display_order` | `integer`, not null | Tenant fields are only ever reordered among themselves (spec Assumptions) — never interleaved with or placed ahead of global fields in the merged render. |
| `created_by` | `text`, not null | `CHECK (created_by IN ('super_admin','tenant_admin'))` — informational; authorization itself comes from RLS + route permission checks, not this column. |
| `archived_at` | `timestamptz`, nullable | `NULL` = active (rendered on forms); set = archived (hidden from future renders, historical values untouched — spec FR-009). Never a hard delete (research.md §7). |
| `created_at` / `updated_at` | `timestamptz`, not null | |

**Constraints**:
- Unique index on `(tenant_id, form_definition_id, field_key)`, exactly as specified — catches
  same-scope collisions (two rows in the same tenant, or two global rows, sharing a key).
- **Does not** by itself catch a cross-scope collision (a tenant field vs. an existing global field, or
  vice versa) — Postgres treats `NULL` `tenant_id` as a different value from a real tenant UUID, so
  those tuples never collide at the index level. Closed by an application-layer check before every
  create, across both scopes (research.md §2).

**Isolation**: RLS **enabled and forced**, three permissive policies (research.md §1):
```
-- 1. Standard tenant-owner shape (used everywhere else in this codebase)
CREATE POLICY "tenant_isolation" ON form_fields
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- 2. Read-only allowance for global rows (mirrors 0018's additive-policy technique)
CREATE POLICY "global_fields_readable" ON form_fields
  FOR SELECT
  USING (tenant_id IS NULL);

-- 3. Super Admin full access (data-model support for the future authoring screen, FR-002)
CREATE POLICY "super_admin_full_access" ON form_fields
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
```
Because policy 1's `WITH CHECK` requires the row's `tenant_id` to equal the caller's own tenant, a
tenant session's `INSERT`/`UPDATE`/`DELETE` on a `tenant_id IS NULL` row can never satisfy it (`NULL =
<uuid>` is `NULL`, not `true`) — so a tenant admin can never write a global row, and policy 2 grants no
write capability at all (`FOR SELECT` only). This is how spec FR-004/User Story 3 hold at the database
layer, not only in the UI.

**Validation rules** (application layer, inside the write transaction):
- `field_key`: required, and unique for this `form_definition_id` across *both* the caller's own tenant
  rows and every global row (research.md §2) — not just within the caller's own scope.
- `field_type`: one of the six supported types (spec FR-008).
- `options`: required (non-empty array) when `field_type` is `select`/`multiselect`; ignored otherwise.
- A tenant-scoped write (create/edit/reorder/archive) must target a row whose `tenant_id` equals the
  caller's own tenant — enforced redundantly at the application layer for a clear 403 message, backed
  by RLS as the real guarantee regardless of what the application layer does.

**State transitions**: `active` (`archived_at IS NULL`) → `archived` (`archived_at` set), one-way in
this spec's scope (no "unarchive" requirement was requested, unlike Department's own archive/unarchive
toggle — flagged as a possible future symmetry, not built here).

---

## Table: `custom_field_values` — tenant-scoped, polymorphic `entity_id`

One entity's stored answer for one field (spec Key Entities — "Custom Field Value").

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK | |
| `tenant_id` | `uuid`, not null, FK → `tenants.id` | Standard tenant ownership — this row always belongs to exactly one tenant (the entity's own). |
| `form_definition_id` | `uuid`, not null, FK → `form_definitions.id`, `ON DELETE RESTRICT` | |
| `entity_id` | `uuid`, not null | The department/TNA-submission/etc. record this value belongs to. **No DB-level FK** — polymorphic across entity tables by design (per the feature request); the calling module (e.g. Department's own route) is responsible for having already confirmed, through its own tenant-scoped fetch, that this id refers to a real entity in the caller's own tenant before saving a value against it. |
| `field_id` | `uuid`, not null, FK → `form_fields.id`, `ON DELETE RESTRICT` | Defense-in-depth only — `form_fields` rows are never hard-deleted (research.md §7), so this should never actually fire. |
| `value` | `jsonb`, not null | Shape implied by the field's `field_type`: a JSON string for `text`/`textarea`/`date`, a JSON number for `number`, a JSON array of strings for `multiselect`, a JSON string for `select` (the chosen option). |
| `created_at` / `updated_at` | `timestamptz`, not null | |

**Constraints**: Unique `(tenant_id, entity_id, field_id)` — one value per entity per field; saving
again for the same entity+field updates the existing row rather than inserting a duplicate.

**Isolation**: RLS **enabled and forced**, the standard single tenant_isolation policy — this table
always has a real tenant, never a global/`NULL` row, so no dual-visibility shape is needed here.

**Validation rules**: A submitted value must match its field's `field_type` (spec FR-007) — validated
against the *merged* field list (research.md §4) at submission time, using whichever field the
submitted `field_id`/`field_key` resolves to (global or tenant-owned, whichever is currently active for
that key). Archived fields are excluded from the set new submissions may target; a value already stored
against a since-archived field is left exactly as it was (spec FR-009/User Story 4).

---

## Relationships

```
form_definitions  1──* form_fields             (form_definition_id)
form_definitions  1──* custom_field_values      (form_definition_id)
form_fields       1──* custom_field_values      (field_id — defense-in-depth FK only)
tenants           1──* form_fields              (tenant_id, nullable — NULL = global)
tenants           1──* custom_field_values       (tenant_id, always present)
(no FK)           departments.id ←── custom_field_values.entity_id (polymorphic, app-layer enforced)
```

## Derived concepts (not columns — computed at request time)

- **Merged field list for a form** (spec FR-006, research.md §4): every active (`archived_at IS NULL`)
  `form_fields` row where `tenant_id IS NULL` (global) or `tenant_id` equals the caller's own tenant,
  for the given `form_definition_id`, ordered by `display_order` — global fields collectively ahead of
  tenant fields (spec Assumptions).
- **Cross-scope key-collision check** (research.md §2): before any tenant create, a lookup for an
  existing `form_fields` row (any `tenant_id`, including `NULL`) matching the same
  `form_definition_id` + `field_key`, not scoped to the caller's own tenant alone.
- **Entity's stored values** (for pre-filling an edit form): every `custom_field_values` row where
  `entity_id` matches and `tenant_id` matches the caller's own tenant (RLS-scoped, no explicit filter
  needed beyond what RLS already applies).
