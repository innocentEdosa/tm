# Data Model: Course Creation

All tables live in the shared Postgres schema (shared schema + RLS isolation model, per constitution
default, unchanged from Specs 001/002 — research.md §2). This spec introduces **three new tables**
(`course_category_templates`, `course_categories`, `courses`) and **two new rows** in the existing
`permissions` catalog. No existing table is altered.

## New table: `course_category_templates` (platform-global, no `tenant_id`)

Mirrors `department_templates` exactly (research.md §1) — the seeded default catalog every tenant's
`course_categories` starts from.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK, default random | |
| `key` | `text`, not null, unique | stable machine key, e.g. `leadership`, `compliance`, `technical`, `soft_skills`, `onboarding`, `other` |
| `name` | `text`, not null | display name, e.g. "Leadership" |
| `created_at` | `timestamptz`, not null, default now | |

**Isolation**: Platform-global, no `tenant_id`, no RLS — `SELECT`-only grant to the application DB
role, identical to `department_templates`/`permissions` (`0001_lock_catalog_grants.sql` pattern
extended).

**Seed data** (one migration, six rows): `leadership`/"Leadership", `compliance`/"Compliance",
`technical`/"Technical", `soft_skills`/"Soft Skills", `onboarding`/"Onboarding", `other`/"Other" — the
exact six named in spec Clarifications/Assumptions.

---

## New table: `course_categories` (tenant-owned, tenant-extensible)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK, default random | |
| `tenant_id` | `uuid`, not null, FK → `tenants.id` | |
| `name` | `text`, not null | |
| `source_template_id` | `uuid`, nullable, FK → `course_category_templates.id`, `ON DELETE SET NULL` | set for seeded defaults; `NULL` for a tenant-created category (mirrors `departments.source_template_id`) |
| `created_by_user_id` | `uuid`, nullable, FK → `users.id`, `ON DELETE SET NULL` | `NULL` for the six rows seeded at provisioning (no human creator) |
| `created_at` | `timestamptz`, not null, default now | |

**Constraints**:
- `uniqueIndex("course_categories_tenant_id_name_unique").on(table.tenantId, sql`lower(${table.name})`)`
  — case-insensitive per-tenant uniqueness (spec Key Entities/Edge Cases), identical technique to
  `departments_tenant_id_name_unique` (research.md §4).

**Isolation**: RLS enabled + forced, standard `tenant_isolation` policy
(`tenant_id = current_setting('app.tenant_id', true)::uuid`), same migration sequence as every prior
tenant table (schema → RLS-enable → grants-lock).

**Seeded**: six rows per tenant at provisioning time (`seedDefaultCourseCategoriesForTenant`, mirroring
`seedDefaultDepartmentsForTenant`'s call site inside `provision-tenant.ts`), each with
`source_template_id` set and `created_by_user_id = NULL`. Existing already-provisioned tenants are
backfilled the same six rows via a one-time data migration (mirrors `0023_backfill_tenant_auth_methods.sql`'s
precedent of backfilling a default for tenants provisioned before the feature existed).

**Created also by**: `POST`/`PATCH .../courses` inline upsert (research.md §3/§4) — no dedicated write
endpoint exists for this table beyond the read list (`GET .../categories`, FR-001c).

**Validation rules**: `name` required, trimmed, unique per tenant case-insensitively (enforced by the
unique index; a `23505` violation on insert is caught by the route and treated as "already exists,
re-resolve to it" rather than surfaced as an error — research.md §4).

**No deletion/archival in this spec** — matches spec Assumptions.

---

## New table: `courses`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK, default random | |
| `tenant_id` | `uuid`, not null, FK → `tenants.id` | |
| `title` | `text`, not null | not unique (spec Assumptions) |
| `description` | `text`, nullable | |
| `category_id` | `uuid`, not null, FK → `course_categories.id`, `ON DELETE RESTRICT` | resolved/created via the inline upsert (research.md §3/§4); `RESTRICT` since no category-deletion path exists in this spec — defense in depth against a future one leaving dangling courses |
| `delivery_mode` | `text`, not null | `CHECK (delivery_mode IN ('in_person', 'virtual', 'self_paced', 'blended'))` |
| `duration_value` | `numeric(6,2)`, not null | `CHECK (duration_value > 0)` |
| `duration_unit` | `text`, not null | `CHECK (duration_unit IN ('minutes', 'hours', 'days'))` |
| `provider` | `text`, nullable | vendor/provider name |
| `cost` | `numeric(12,2)`, nullable | `CHECK (cost IS NULL OR cost >= 0)`; `NULL` = "not yet priced" (spec Edge Cases), not free |
| `status` | `text`, not null, default `'draft'` | `CHECK (status IN ('draft', 'active', 'archived'))` |
| `created_by_user_id` | `uuid`, nullable, FK → `users.id`, `ON DELETE SET NULL` | |
| `updated_by_user_id` | `uuid`, nullable, FK → `users.id`, `ON DELETE SET NULL` | |
| `created_at` | `timestamptz`, not null, default now | |
| `updated_at` | `timestamptz`, not null, default now | app-set on every update (research.md §8) |

**Constraints (new)**:
- `delivery_mode`, `duration_unit`, `status` — `CHECK` constraints as above (mirrors
  `departments_status_check`'s existing convention).
- `duration_value > 0`, `cost >= 0` (when present) — `CHECK` constraints.
- `category_id` FK, `ON DELETE RESTRICT`.

**Isolation**: RLS enabled + forced, standard `tenant_isolation` policy, same migration sequence as
every prior tenant table.

**Indexes**:
- `index("courses_tenant_id_status_idx").on(table.tenantId, table.status)` — backs the default
  (`status != 'archived'`) list filter and the explicit `status=` filter (mirrors
  `training_needs_tenant_id_status_idx`).
- `index("courses_tenant_id_category_id_idx").on(table.tenantId, table.categoryId)` — backs the
  category filter.
- No trigram/GIN index for title search — matches this codebase's existing precedent (`departments`'
  and `training_needs`' own name/title search both run a plain `ILIKE`/`.toLowerCase().includes()`
  with no dedicated search index) at the same modest per-tenant scale; SC-002's 500-row target does not
  warrant introducing `pg_trgm` (a new extension, Principle XIII) for this spec.

**Validation rules** (application layer, inside the write transaction):
- `title`: required, non-blank.
- `category`: required on create; resolved/auto-created per research.md §3/§4; not itself validated
  against a fixed enum (spec FR-010).
- `deliveryMode`: required, one of the fixed enum values.
- `duration`: required — `{ value: number > 0, unit: 'minutes' | 'hours' | 'days' }`.
- `description`, `provider`, `cost`: optional; `cost`, if present, must be `>= 0`.
- `status`: optional on create (defaults `draft`); on update, any of the three enum values is
  accepted with no restricted transition graph (spec FR-005/Clarifications — un-archiving via a normal
  update is allowed).

**State transitions**: `draft` ↔ `active` ↔ `archived`, freely reversible in any direction via
`PATCH`, no restricted graph (spec Clarifications). The dedicated archive action
(`POST .../courses/:id/archive`) is a convenience shorthand for `status = 'archived'`, not the only path
there, and treats an already-`archived` course as a no-op success (FR-006).

---

## Extended catalog: `permissions` (existing, from Spec 001 — two new rows, no schema change)

| `key` | `display_name` | `category` |
|---|---|---|
| `course.view` | View Courses | `course` |
| `course.manage` | Manage Courses | `course` |

Seeded via a migration mirroring `0025_seed_department_permissions.sql` (research.md §5) — granted to
the `hr_admin` role template and backfilled onto every already-live tenant's `hr_admin`-sourced role
row (matched by `source_template_id` **and** by role name in the same statement, per the `0038`-learned
combined approach). `course.manage` is treated as inherently including `course.view` at the
route-enforcement level (every manage-gated route's read parts also accept `course.manage`), not by one
permission row implying another in the catalog itself — identical convention to `department.*`.

**Isolation**: Same as every other `permissions` row — platform-global, no `tenant_id`, `SELECT`-only
grant to the application DB role.

---

## Relationships

```
tenants                    1──* course_categories        (new)
tenants                    1──* courses                  (new)
course_category_templates  1──* course_categories         (new: source_template_id, nullable)
course_categories          1──* courses                   (new: category_id, required, ON DELETE RESTRICT)
users                      0..1──* courses                (new: created_by_user_id, ON DELETE SET NULL)
users                      0..1──* courses                (new: updated_by_user_id, ON DELETE SET NULL)
users                      0..1──* course_categories       (new: created_by_user_id, ON DELETE SET NULL)
permissions                (2 new rows: course.view, course.manage — consumed by roles/role_permissions
                            exactly like every existing permission, no schema change there)
```

## Derived concepts (not columns — computed at request time)

- **Default list scope** (spec FR-002): `WHERE tenant_id = :tenant AND status != 'archived'` unless an
  explicit `status` filter is supplied, in which case that filter replaces the default exclusion
  (RLS-scoped via `request.tenantDb`, no explicit tenant filter needed beyond what RLS already applies
  — kept explicit anyway as a defense-in-depth convention, matching `training_needs`' own list query).
- **Title search** (spec FR-003): `WHERE title ILIKE '%' || :search || '%'`, applied in addition to any
  category/delivery-mode/status filters.
- **Category resolve-or-create** (research.md §3/§4): given an incoming category name, `SELECT id FROM
  course_categories WHERE tenant_id = :tenant AND lower(name) = lower(:name)`; if zero rows, `INSERT
  ... ON CONFLICT (tenant_id, lower(name)) DO NOTHING RETURNING id`, then re-`SELECT` if the insert
  hit the conflict branch (race-safe, no explicit row lock needed).
