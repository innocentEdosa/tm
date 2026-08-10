# Data Model: Reusable Form Builder & Form Renderer

All tables live in the shared Postgres schema (shared schema + RLS isolation model, per
constitution default). This spec **extends four existing tables** (`form_definitions`,
`form_fields`, `form_field_order_overrides`, `custom_field_values` — all from spec 010) and
**adds three new tables** (`form_versions`, `form_steps`, `form_sections`). No existing row is
deleted or renumbered; every extension is additive (new nullable columns) and backfilled by
migration so existing behavior is unaffected until a consumer opts into the new fields.

---

## Table: `form_definitions` — EXTENDED, platform-global, no `tenant_id`

The catalog of form types. Previously developer-registered/migration-only (spec 010 FR-001); now
runtime-creatable by a Super Admin (spec FR-001).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK | *(existing)* |
| `key` | `text`, unique, not null | *(existing)* Stable identifier, e.g. `department`, `role`. |
| `name` | `text`, not null | *(existing)* |
| `description` | `text`, not null | *(existing)* |
| `icon` | `text`, nullable | **NEW** — an icon identifier from the existing design system's icon set; purely presentational. |
| `status` | `text`, not null, default `'active'` | **NEW** — `CHECK (status IN ('active','archived'))`. An archived form type is hidden from the Form Builder's create-new-form UI but its historical versions/data remain intact and queryable. |
| `active_version_id` | `uuid`, nullable, FK → `form_versions.id` | **NEW** — the currently published version consuming features resolve against. `NULL` until a first version is published. Added via a follow-up `ALTER TABLE` after `form_versions` exists (breaks the circular FK ordering). |
| `created_by_super_admin_id` | `uuid`, nullable, FK → `super_admins.id` | **NEW** — `NULL` for the 3 pre-existing rows backfilled by migration (originally created by a deploy, not a Super Admin action). |
| `created_at` | `timestamptz`, not null, default `now()` | *(existing)* |
| `updated_at` | `timestamptz`, not null, default `now()` | **NEW** |

**Grants/RLS change**: migration `0029_lock_custom_fields_catalog_grants.sql` revoked
`INSERT/UPDATE/DELETE` from `tm_app`. This spec re-`GRANT`s `INSERT, UPDATE` (not `DELETE`) and
adds:
```sql
ALTER TABLE form_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_full_access" ON form_definitions
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
-- existing SELECT-to-everyone behavior preserved by a permissive read policy:
CREATE POLICY "readable_by_all" ON form_definitions FOR SELECT USING (true);
```
No ordinary tenant session gains write access — only a verified Super Admin session (research.md
§5) can insert/update. This is what makes spec FR-001 ("create a form type with no migration")
safe.

**Validation rules**: `key` immutable after creation (FR-003); `key` unique (FR-002); `status`
transition `active → archived` only, never reversed through a delete.

---

## Table: `form_versions` — NEW, platform-global, no `tenant_id`

One buildable/publishable snapshot of a form type's steps/sections/fields/layout.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK | |
| `form_definition_id` | `uuid`, not null, FK → `form_definitions.id`, `ON DELETE RESTRICT` | |
| `version_number` | `integer`, not null | Monotonically increasing per form type, starting at 1. |
| `status` | `text`, not null, default `'draft'` | `CHECK (status IN ('draft','published','archived'))`. |
| `layout_config` | `jsonb`, nullable | Form-wide layout defaults (e.g. grid column count); per-field overrides live on `form_fields.layout`. |
| `created_by_super_admin_id` | `uuid`, nullable, FK → `super_admins.id` | `NULL` for the version-1 rows backfilled by migration. |
| `created_at` / `updated_at` | `timestamptz`, not null | |
| `published_at` | `timestamptz`, nullable | Set exactly once, on the transition into `published`. |
| `archived_at` | `timestamptz`, nullable | Set when a newer version is published (this one is superseded) or explicitly archived. |

**Constraints**: `UNIQUE (form_definition_id, version_number)`.

**State machine** (FR-005–FR-011):
```
draft ──publish──▶ published ──(a newer version is published)──▶ archived
  │
  └──(discarded without publishing — stays draft indefinitely, or is explicitly archived)
```
- Only one `published` row per `form_definition_id` at any time — enforced at the application
  layer inside the publish transaction: (1) validate the draft (≥1 section — FR-007), (2) set
  the current draft's `status = 'published'`, `published_at = now()`, (3) if a previously
  published version exists for this form type, set its `status = 'archived'`, `archived_at =
  now()`, (4) update `form_definitions.active_version_id` to point at the new version — all
  inside one transaction, so there is never an observable moment with zero or two active
  versions (FR-008, SC-008).
- A `draft`/`archived` version's steps/sections/fields are never editable through the tenant- or
  builder-facing write routes — only a `published` version's own draft-in-progress (i.e., the
  one currently `status = 'draft'`) accepts edits (FR-009).

**Grants/RLS**: `SELECT` to `tm_app` (any tenant session can read a form type's published
version); writes only via `super_admin_full_access` policy, same shape as `form_definitions`.

---

## Table: `form_steps` — NEW, platform-global, scoped to a `form_version`

An ordered, optionally-skippable wizard stage (FR-017).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK | |
| `form_version_id` | `uuid`, not null, FK → `form_versions.id`, `ON DELETE CASCADE` | Deleting a draft version (before it's ever published) cascades; published/archived versions are never deleted. |
| `key` | `text`, not null | Stable per-version identifier (e.g. `basic-info`), used for cross-version reconciliation (research.md, spec FR-025). |
| `title` | `text`, not null | |
| `description` | `text`, nullable | |
| `display_order` | `integer`, not null | |
| `is_optional` | `boolean`, not null, default `false` | |
| `created_at` / `updated_at` | `timestamptz`, not null | |

**Constraints**: `UNIQUE (form_version_id, key)`, `UNIQUE (form_version_id, display_order)`.

**Grants/RLS**: same shape as `form_versions`.

---

## Table: `form_sections` — NEW, platform-global, scoped to a `form_version`

A named, ordered group of fields, optionally within a step (FR-018).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK | |
| `form_version_id` | `uuid`, not null, FK → `form_versions.id`, `ON DELETE CASCADE` | |
| `form_step_id` | `uuid`, nullable, FK → `form_steps.id`, `ON DELETE CASCADE` | `NULL` = the version has no steps; this section sits directly on the form. |
| `key` | `text`, not null | Stable per-version identifier, used for reconciliation (spec FR-025), same role as `form_steps.key`. |
| `title` | `text`, not null | |
| `description` | `text`, nullable | |
| `display_order` | `integer`, not null | Ordered within its parent step (or within the version, if no step). |
| `created_at` / `updated_at` | `timestamptz`, not null | |

**Constraints**: `UNIQUE (form_version_id, key)`.

**Migration backfill note**: every pre-existing `form_definitions` row (`department`, `member`,
`training_needs_analysis`) gets exactly one `form_versions` row (`version_number = 1, status =
'published'`) and exactly one default `form_sections` row (`key = 'general', form_step_id =
NULL`) — this is the "form with zero configured steps/sections behaves exactly as before"
guarantee (spec Edge Cases).

**Grants/RLS**: same shape as `form_versions`.

---

## Table: `form_fields` — EXTENDED, dual-scope (platform version-scoped, or tenant-owned)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK | *(existing)* |
| `form_definition_id` | `uuid`, not null, FK → `form_definitions.id` | *(existing)* |
| `tenant_id` | `uuid`, nullable, FK → `tenants.id` | *(existing)* `NULL` = platform-authored (system or platform-owned); non-null = tenant-owned. |
| `form_version_id` | `uuid`, nullable, FK → `form_versions.id`, `ON DELETE CASCADE` | **NEW** — set for platform-authored rows (`tenant_id IS NULL`); `NULL` for tenant-owned rows, which aren't version-scoped (spec Assumptions — tenant customizations aren't versioned/published, they apply immediately). |
| `form_section_id` | `uuid`, nullable, FK → `form_sections.id` | **NEW** — placement within the version's layout. `NULL` falls back to the version's default section. For tenant-owned fields, this points at *the currently active version's* section (reconciled by `key` on republish, spec FR-025). |
| `field_key` | `text`, not null | *(existing)* |
| `label` | `text`, not null | *(existing)* |
| `description` | `text`, nullable | **NEW** — help text (FR-013). |
| `placeholder` | `text`, nullable | **NEW** (FR-013). |
| `field_type` | `text`, not null | *(existing, extended)* `CHECK (field_type IN ('text','textarea','number','email','url','date','datetime','select','multiselect','radio','checkbox','toggle','file'))`. |
| `options` | `jsonb`, nullable | *(existing)* Array of plain strings; `select`/`multiselect`/`radio` only. |
| `default_value` | `jsonb`, nullable | **NEW** (FR-013). |
| `validation` | `jsonb`, nullable | **NEW** — e.g. `{ min, max, pattern }`, applicable subset depends on `field_type` (FR-013). |
| `is_required` | `boolean`, not null, default `false` | *(existing)* |
| `display_order` | `integer`, not null | *(existing)* |
| `layout` | `jsonb`, nullable | **NEW** — `{ colSpan }` (1–12, default 12) (FR-016). |
| `created_by` | `text`, not null | *(existing)* `CHECK (created_by IN ('super_admin','tenant_admin','system'))` — unchanged, already covers this feature's needs. |
| `is_system` | `boolean`, not null, default `false` | *(existing)* Unchanged meaning — a placeholder for a consuming module's own hardcoded field. |
| `archived_at` | `timestamptz`, nullable | *(existing)* |
| `created_at` / `updated_at` | `timestamptz`, not null | *(existing)* |

**Ownership derivation** (FR-015, unchanged logic from spec 010, now with a third tier made
explicit in the API response shape, not a new column):
```
is_system = true                          → System
is_system = false, tenant_id IS NULL      → Platform
is_system = false, tenant_id IS NOT NULL  → Tenant
```

**Validation rules**: `field_key` unique per `form_definition_id` across platform + all tenant
scopes together (existing `fieldKeyCollisionExists`, unchanged — FR-014); `field_type` one of the
extended set (FR-012); `options` required when `field_type` is `select`/`multiselect`/`radio`
(existing check, extended to `radio`); a **platform field row can only be inserted/edited/archived
by a Super Admin session, and only while its `form_version_id` points at a `status = 'draft'`
version** (FR-009) — enforced in the platform routes, not by a DB constraint (draft-vs-published
is a `form_versions.status` lookup, not expressible as a `CHECK` on this table alone).

---

## Table: `form_field_order_overrides` — EXTENDED (tenant "override" table)

Generalizes from "position only" to "position + visibility" — this is the mechanism for spec
FR-021/FR-024 (tenant hides an optional platform field, never deletes it).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK | *(existing)* |
| `tenant_id` | `uuid`, not null, FK → `tenants.id` | *(existing)* |
| `form_definition_id` | `uuid`, not null, FK → `form_definitions.id` | *(existing)* |
| `field_id` | `uuid`, not null, FK → `form_fields.id`, `ON DELETE CASCADE` | *(existing)* |
| `display_order` | `integer`, nullable | *(existing, now nullable)* `NULL` = use the field's own seeded order; a value = this tenant's override. |
| `is_hidden` | `boolean`, not null, default `false` | **NEW** (FR-021). |
| `created_at` / `updated_at` | `timestamptz`, not null | *(existing)* |

**Constraints**: `UNIQUE (tenant_id, field_id)` *(existing)*.

**Validation rules** (FR-022, enforced server-side in the write route, not just hidden in the
UI): a write setting `is_hidden = true` is rejected with `403` when the target `form_fields.id`
resolves to a row with `is_system = true` **or** `is_required = true`. This is the single
enforcement point for "required/system fields can never be hidden or removed" — the same
function is called whether the caller is a Tenant Admin's own action or (theoretically) any other
authenticated path, so there is no separate code path that could forget the check.

**Grants/RLS**: unchanged from spec 010 (`tenant_isolation` policy — a tenant session can only
read/write its own rows; no `super_admin_full_access` needed since Tenant Admins already write
through their own tenant session, and Super Admin has no legitimate reason to write another
tenant's override rows in this feature).

---

## Table: `custom_field_values` — EXTENDED

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK | *(existing)* |
| `tenant_id` | `uuid`, not null, FK → `tenants.id` | *(existing)* |
| `form_definition_id` | `uuid`, not null, FK → `form_definitions.id` | *(existing)* |
| `form_version_id` | `uuid`, nullable, FK → `form_versions.id`, `ON DELETE RESTRICT` | **NEW** — the platform version that was active when this value was written (FR-032). `NULL` for values written before this migration (interpreted as "version 1" by convention when displaying legacy records). |
| `entity_id` | `uuid`, not null | *(existing)* Polymorphic, no FK (existing, unchanged design). |
| `field_id` | `uuid`, not null, FK → `form_fields.id` | *(existing)* |
| `value` | `jsonb`, not null | *(existing)* |
| `created_at` / `updated_at` | `timestamptz`, not null | *(existing)* |

**Constraints**: `UNIQUE (tenant_id, entity_id, field_id)` *(existing, unchanged — resaving
replaces, not duplicates)*.

**Grants/RLS**: unchanged (existing `tenant_isolation` + `super_admin_full_access` policies from
spec 010 / migration `0067`).

---

## Effective Form (resolved shape, not a table)

`getEffectiveForm(tenantDb, formKey, tenantId)` returns a value of this shape — the contract
`<FormRenderer>` consumes (see `contracts/`):

```
EffectiveForm {
  formKey: string
  formVersionId: string
  steps: [{
    key: string, title: string, description: string | null, isOptional: boolean,
    sections: [{
      key: string, title: string, description: string | null,
      fields: [{
        id, fieldKey, label, description, placeholder, fieldType, options, defaultValue,
        validation, isRequired, layout: { colSpan }, scope: "system" | "platform" | "tenant",
        needsReview: boolean   // true only for a tenant field/override whose original
                                // step/section key no longer exists post-republish (FR-025)
      }]
    }]
  }]
}
```

A form with zero configured steps renders as a single implicit step containing its section(s) —
this is a rendering convention, not a stored row, so the "zero steps = flat form" edge case never
needs special-casing in the resolver.

## Migration Sequencing (non-destructive, per FR-033/FR-034)

1. Create `form_versions`, `form_steps`, `form_sections` (no FK from `form_definitions` yet).
2. Add nullable `form_definitions.active_version_id` (FK now resolvable).
3. Add new nullable columns to `form_fields`, `form_field_order_overrides`, `custom_field_values`;
   extend `form_fields.field_type` and add `created_by`/ownership-adjacent checks as needed.
4. Re-grant `INSERT, UPDATE` on `form_definitions` to `tm_app`; add `super_admin_full_access` RLS
   policies to all new/reopened tables.
5. **Data backfill** (one migration per existing form type, mirroring spec 010's
   `0036_seed_department_system_fields.sql` pattern): for `department`, `member`,
   `training_needs_analysis` — insert `version_number = 1, status = 'published'`, set
   `active_version_id`, insert one default `form_sections` row (`key = 'general'`), backfill
   every existing platform `form_fields` row's `form_version_id`/`form_section_id`. Tenant-owned
   `form_fields` rows get `form_section_id` backfilled (to render in the same place) but
   `form_version_id` stays `NULL` (not version-scoped, per data model above).
6. Verify: `SELECT count(*) FROM form_fields WHERE tenant_id IS NULL AND form_version_id IS NULL`
   returns `0` after backfill (every platform field must land in exactly one version).
