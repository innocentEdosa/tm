# Data Model: Course Content

All tables live in the shared Postgres schema (shared schema + RLS isolation model, unchanged —
research.md §2). This spec introduces **two new tables** (`course_modules`, `content_items`). No
existing table (`courses`, `course_categories`, `permissions`) is altered.

## New table: `course_modules`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK, default random | |
| `tenant_id` | `uuid`, not null, FK → `tenants.id` | denormalized for RLS (research.md §2) |
| `course_id` | `uuid`, not null, FK → `courses.id`, `ON DELETE RESTRICT` | `courses` rows are never hard-deleted (spec 023 FR-011), so this is defense-in-depth |
| `title` | `text`, not null | |
| `description` | `text`, nullable | |
| `position` | `integer`, not null | server-computed only — append-on-create, full-rewrite-on-reorder (research.md §4); never client-supplied |
| `created_by_user_id` | `uuid`, nullable, FK → `users.id`, `ON DELETE SET NULL` | |
| `updated_by_user_id` | `uuid`, nullable, FK → `users.id`, `ON DELETE SET NULL` | |
| `created_at` / `updated_at` | `timestamptz`, not null, default now | `updated_at` app-set on every write |

**Constraints**: None beyond the FKs above — no DB-level uniqueness on `(course_id, position)`
(research.md §4 explains why).

**Isolation**: RLS enabled + forced, standard `tenant_isolation` policy, same migration sequence as
every prior tenant table.

**Indexes**: `index("course_modules_tenant_id_course_id_idx").on(tenantId, courseId)` — backs both the
curriculum-read query and the reorder handler's "fetch current set" lookup, ordered by `position`.

**Validation rules** (application layer): `title` required, non-blank. `courseId` (on create) must
resolve via `request.tenantDb` to a course in the caller's tenant — a non-resolving id is rejected as
`404`, not `422` (RLS makes a cross-tenant course id simply not found, spec FR-010).

---

## New table: `content_items`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK, default random | |
| `tenant_id` | `uuid`, not null, FK → `tenants.id` | denormalized for RLS |
| `course_id` | `uuid`, not null, FK → `courses.id`, `ON DELETE RESTRICT` | denormalized from the owning module at creation, write-once (research.md §1 — never changes, since FR-008 only allows moving within the same course) |
| `module_id` | `uuid`, not null, FK → `course_modules.id`, `ON DELETE CASCADE` | deleting a module deletes its content items (spec FR-009, research.md §5) |
| `type` | `text`, not null | `CHECK (type IN ('video', 'article', 'live_class', 'test', 'assignment', 'external_import'))`; immutable after creation (spec Assumptions — enforced in the route handler, not the database, since Postgres has no "column is write-once" constraint) |
| `title` | `text`, not null | |
| `description` | `text`, nullable | common instructions/description field across every type |
| `position` | `integer`, not null | server-computed only, scoped within `module_id` (research.md §4) |
| `payload` | `jsonb`, not null, default `'{}'` | type-specific fields, shape validated in the route handler per `type` (research.md §3) |
| `created_by_user_id` | `uuid`, nullable, FK → `users.id`, `ON DELETE SET NULL` | |
| `updated_by_user_id` | `uuid`, nullable, FK → `users.id`, `ON DELETE SET NULL` | |
| `created_at` / `updated_at` | `timestamptz`, not null, default now | |

**Constraints**: `type` `CHECK` as above. No DB-level uniqueness on `(module_id, position)`
(research.md §4).

**Isolation**: RLS enabled + forced, standard `tenant_isolation` policy.

**Indexes**: `index("content_items_tenant_id_course_id_idx").on(tenantId, courseId)` — backs the
curriculum-read query (fetch every content item for a course in one query, grouped by `module_id` in
application code). `index("content_items_tenant_id_module_id_idx").on(tenantId, moduleId)` — backs the
reorder handler's "fetch current set for this module" lookup, ordered by `position`.

**`payload` shape per `type`** (application-validated, spec FR-004):

| `type` | Required `payload` fields | Optional `payload` fields |
|---|---|---|
| `video` | `url` (string) | — |
| `article` | at least one of `body` (string) / `externalUrl` (string) | the other of the pair |
| `live_class` | `scheduledAt` (ISO-8601 datetime string) | `facilitator` (string), `meetingLink` (string), `capacity` (integer) |
| `test` | — | `passCriteria` (string, free text — spec Assumptions: not an enforced rule) |
| `assignment` | — | — (title/description alone are sufficient — spec Assumptions) |
| `external_import` | `url` (string), `sourceType` (string, free text label e.g. `"scorm"`) | — |

**Validation rules** (application layer):
- `type` required on create, one of the fixed six values; immutable on update (a request attempting to
  change it is rejected `422`).
- `title` required, non-blank.
- `payload` validated against the table above for the item's `type`, on both create and update.
- `moduleId` (on create) must resolve via `request.tenantDb` to a module in the caller's tenant — `404`
  if not found (RLS).
- `moduleId` (on update, i.e. a move — spec FR-008): the target module must resolve in the caller's
  tenant (`404` if not) **and** its `course_id` must equal the content item's own `course_id` (`422`,
  "cannot move a content item to a module in a different course" — research.md §6). Moving resets
  `position` to append-last in the target module (research.md §4c).

**State transitions**: None beyond `type` immutability (no lifecycle/status field on either table in
this spec — unlike `courses`, neither entity has a draft/active/archived concept here).

---

## Relationships

```
tenants          1──* course_modules      (new)
tenants          1──* content_items       (new)
courses          1──* course_modules      (new: course_id, ON DELETE RESTRICT)
courses          1──* content_items       (new: course_id, denormalized, write-once, ON DELETE RESTRICT)
course_modules   1──* content_items       (new: module_id, ON DELETE CASCADE)
users            0..1──* course_modules   (new: created_by_user_id / updated_by_user_id, ON DELETE SET NULL)
users            0..1──* content_items    (new: created_by_user_id / updated_by_user_id, ON DELETE SET NULL)
```

No change to `permissions` — this spec adds zero rows there (research.md §8).

## Derived concepts (not columns — computed at request time)

- **Full curriculum** (spec FR-002): `SELECT * FROM course_modules WHERE course_id = :course ORDER BY
  position`, then `SELECT * FROM content_items WHERE course_id = :course ORDER BY position` (both
  RLS-scoped via `request.tenantDb`), with content items grouped by `module_id` in application code and
  nested under their module in the response — two flat queries, no join, per research.md §1.
- **Reorder's "current set"** (spec FR-007): the exact id list currently returned by the same ordered
  query above, scoped to the course (modules) or a single module (content items) — compared against the
  submitted list as an unordered set-equality check before the batch position rewrite proceeds.
- **Append position** (creates and cross-module moves): `count(*) FROM course_modules WHERE course_id =
  :course` (or the `content_items` equivalent scoped to `module_id`), computed inside the same
  transaction as the insert/update to avoid a race with a concurrent append (research.md §4).
