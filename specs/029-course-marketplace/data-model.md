# Phase 1 Data Model: Course Marketplace

## `platform_courses`

No `tenant_id`. No RLS (research.md §1 of spec's Constitution Check — protection is route-layer
`requireSuperAdminSession` only, same class as `permissions`/`role_templates`/`course_category_templates`).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `defaultRandom()` |
| `title` | text NOT NULL | |
| `description` | text | nullable |
| `category_name` | text NOT NULL | plain name, not an FK — see spec Clarifications §5 |
| `delivery_mode` | text NOT NULL | CHECK in `('in_person','virtual','self_paced','blended')` — same enum as `courses.delivery_mode` |
| `duration_value` | numeric(6,2) NOT NULL | CHECK `> 0` |
| `duration_unit` | text NOT NULL | CHECK in `('minutes','hours','days')` |
| `provider` | text | nullable |
| `cost` | numeric(12,2) | nullable; CHECK `is null or >= 0`; null/0 = free (FR-008) |
| `status` | text NOT NULL default `'draft'` | CHECK in `('draft','active','archived')` |
| `created_by_super_admin_id` | uuid FK → `super_admins.id` ON DELETE SET NULL | |
| `updated_by_super_admin_id` | uuid FK → `super_admins.id` ON DELETE SET NULL | |
| `created_at` / `updated_at` | timestamptz NOT NULL default now() | |

Indexes: `(status)` (marketplace browse filters by `active`); `(category_name)`.

**Immutability rule (FR-013)**: enforced in application code (`platform-course-immutability.ts`), not a
DB constraint — checks whether any `marketplace_selections` row referencing this course has status
`fulfilled` before allowing edit/delete of this course, its modules, its content items, or their
attachments.

## `platform_course_modules`

No `tenant_id`. Same shape as `course_modules` minus `tenant_id`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `platform_course_id` | uuid NOT NULL FK → `platform_courses.id` ON DELETE RESTRICT | RESTRICT, not CASCADE — deleting a platform course with modules must go through the immutability/dependency check, not silently cascade |
| `title` | text NOT NULL | |
| `description` | text | nullable |
| `position` | integer NOT NULL | server-computed, append-only on create (mirrors spec 024) |
| `created_by_super_admin_id` / `updated_by_super_admin_id` | uuid FK → `super_admins.id` | |
| `created_at` / `updated_at` | timestamptz | |

Index: `(platform_course_id)`.

## `platform_course_content_items`

No `tenant_id`. Same shape as `content_items` minus `tenant_id`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `platform_course_module_id` | uuid NOT NULL FK → `platform_course_modules.id` ON DELETE CASCADE | deleting a module still cascades its own items (spec 024 precedent) — the *course*-level RESTRICT above is what forces the immutability check, not this cascade |
| `platform_course_id` | uuid NOT NULL FK → `platform_courses.id` ON DELETE RESTRICT | denormalized from module, same convention as `content_items.course_id` |
| `type` | text NOT NULL | CHECK in `('video','article','live_class','test','assignment','external_import')` — identical enum to `content_items.type`, immutable once set |
| `title` | text NOT NULL | |
| `description` | text | nullable |
| `payload` | jsonb NOT NULL default `'{}'` | same per-type shape as `content_items.payload`, validated by the same `validateContentItemPayload` (research.md §6) |
| `position` | integer NOT NULL | server-computed, append-only |
| `created_by_super_admin_id` / `updated_by_super_admin_id` | uuid FK → `super_admins.id` | |
| `created_at` / `updated_at` | timestamptz | |

Index: `(platform_course_module_id)`, `(platform_course_id)`.

## `platform_file_attachments`

No `tenant_id` (research.md §2). Same shape as `file_attachments` minus `tenant_id`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `entity_type` | text NOT NULL | CHECK `= 'platform_content_item'` (single value today, extensible enum convention preserved) |
| `entity_id` | uuid NOT NULL | no DB FK, polymorphic — points at `platform_course_content_items.id` |
| `file_name` | text NOT NULL | |
| `content_type` | text NOT NULL | |
| `size_bytes` | bigint NOT NULL | |
| `storage_key` | text NOT NULL UNIQUE | unique is safe here — nothing clones *into* this table (research.md §1 contrast) |
| `status` | text NOT NULL default `'pending'` | CHECK in `('pending','ready')` |
| `created_by_super_admin_id` | uuid FK → `super_admins.id` ON DELETE SET NULL | |
| `created_at` / `updated_at` | timestamptz | |

Index: `(entity_type, entity_id)`.

## `marketplace_selections`

`tenant_id` NOT NULL. RLS `ENABLE`+`FORCE`, `tenant_isolation` + `super_admin_full_access` policies
(research.md §3).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL FK → `tenants.id` | |
| `platform_course_id` | uuid NOT NULL FK → `platform_courses.id` ON DELETE RESTRICT | |
| `status` | text NOT NULL default `'requested'` | CHECK in `('requested','paid','rejected','fulfilled')` |
| `cloned_course_id` | uuid FK → `courses.id` ON DELETE SET NULL | nullable; set only once `fulfilled` |
| `requested_by_user_id` | uuid NOT NULL FK → `users.id` | the tenant user who selected |
| `requested_at` | timestamptz NOT NULL default now() | |
| `resolved_by_super_admin_id` | uuid FK → `super_admins.id` ON DELETE SET NULL | nullable until resolved |
| `resolved_at` | timestamptz | nullable until resolved |
| `created_at` / `updated_at` | timestamptz | |

Constraint: **partial unique index** `marketplace_selections_tenant_platform_course_active_unique` on
`(tenant_id, platform_course_id) WHERE status != 'rejected'` — enforces FR-009 (at most one
non-`rejected` selection per tenant/platform-course pair) at the database layer, not just application
logic; a new selection is only insertable once a prior one has moved to `rejected` or none exists.

Index: `(status)` (Super Admin queue filters by `requested`); `(tenant_id)`.

## `file_attachments` (existing table, one change)

Drop `file_attachments_storage_key_unique` (research.md §1). No other column change. A cloned content
item's `file_attachments` row is inserted with `entity_type = 'content_item'`, `entity_id` = the new
tenant-owned content item's id, and `storage_key` = the value copied from the platform original's
`platform_file_attachments` row for the corresponding source content item.

## Entity relationship summary

```text
platform_courses ──< platform_course_modules ──< platform_course_content_items ──< platform_file_attachments
       │                                                                                  (via entity_id,
       │                                                                                   no DB FK)
       └──< marketplace_selections >── tenants
                     │
                     └── cloned_course_id ──> courses (existing, tenant-scoped, spec 023/024)
                                                  │
                                                  └──< course_modules ──< content_items ──< file_attachments
                                                       (existing, spec 024)                (existing, spec 025;
                                                                                             storage_key shared
                                                                                             with the platform
                                                                                             original, never
                                                                                             re-uploaded)
```
