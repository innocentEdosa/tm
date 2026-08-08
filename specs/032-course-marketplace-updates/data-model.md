# Data Model: Course Marketplace Updates

Extends the entities introduced in `specs/029-course-marketplace/data-model.md`. Only the deltas are
shown below; unlisted columns are unchanged from 029.

## `platform_courses` (existing table, gains one column)

| Column | Type | Notes |
|---|---|---|
| `version` | `integer not null default 1` | Incremented by 1 inside the same transaction as every successful content-affecting write (research.md §2). Never decremented, never reset. |

No behavior change to any existing column — in particular, the removal of `IMMUTABLE_ONCE_CLONED_FIELDS`
(research.md §1) is a route-layer behavior change, not a schema change; `title`/`category_name`/
`delivery_mode`/`duration_value`/`duration_unit` remain plain editable columns as they always were.

## `course_modules` (existing tenant table, gains one column)

| Column | Type | Notes |
|---|---|---|
| `source_platform_course_module_id` | `uuid null references platform_course_modules(id) on delete set null` | Set at clone time and at every subsequent "apply update" for modules that originated from a platform course. `NULL` for a module a tenant authored directly (not from the marketplace) or added to a cloned course themselves. Drives the match-by-id logic in research.md §4 — never used for display. |

Index: `course_modules_source_platform_course_module_id_idx` on this column (apply-update needs to look
up "does a tenant module already exist for platform module X" by this column, scoped to one course).

## `content_items` (existing tenant table, gains one column)

| Column | Type | Notes |
|---|---|---|
| `source_platform_course_content_item_id` | `uuid null references platform_course_content_items(id) on delete set null` | Same purpose as above, one level down. This is the column that makes "keep progress, update content" possible: `learner_content_progress.content_item_id` has no FK (learner-content-progress.ts, deliberately, per its own doc comment), so as long as a content item that persists across a platform edit keeps the same `content_items.id` on the tenant side, every progress row referencing it keeps resolving with zero migration needed (research.md §4). |

Index: `content_items_source_platform_course_content_item_id_idx` on this column, same reasoning.

**On delete of the platform-side row** (`on delete set null`, not cascade/restrict): if a Super Admin
deletes a platform module/content-item entirely, an already-cloned tenant copy's `source_...` column
just goes `NULL` — the tenant's row itself is untouched (still fully valid, still has its content) until
that tenant explicitly applies a future update, at which point "apply update" treats a tenant row with a
now-`NULL` (or non-matching) source as "no longer present upstream" per the reconciliation rule and may
delete it then, not before. This is what "must NOT be modified by anything other than an explicit apply
action" (FR-002/FR-010) requires — the platform side deleting its own row must never reach into a
tenant's existing content out from under them.

## `marketplace_selections` (existing table, gains three columns)

| Column | Type | Notes |
|---|---|---|
| `applied_platform_course_version` | `integer not null default 1` | Set to the platform course's `version` at the exact moment `clonePlatformCourseIntoTenant` runs (free-course immediate select, or a paid selection's admin-resolve). Advanced to the platform course's then-current `version` every time this tenant successfully applies an update. This is "which version is the tenant's clone currently on." |
| `notified_platform_course_version` | `integer null` | Stamped by the version-bump-and-notify routine after successfully queueing/sending an update-available email for a given version (research.md §5). `NULL` until the first notification is ever sent for this selection. |
| `dismissed_platform_course_version` | `integer null` | Stamped when the tenant explicitly dismisses the currently-outstanding update (research.md §5). `NULL` until the tenant's first dismiss action. |

Only meaningful on a row whose `status = 'fulfilled'` (the only status with a real `clonedCourseId` to
apply an update onto) — left at their defaults on `requested`/`paid`/`rejected` rows, which this feature
does not otherwise touch.

**Derived states** (computed at read time from `platform_courses.version` joined against these three
columns — never stored):

- **Update available**: `platformCourse.version > selection.appliedPlatformCourseVersion AND selection.dismissedPlatformCourseVersion IS DISTINCT FROM platformCourse.version`
- **Notification still owed** (internal, used only by the version-bump routine): `platformCourse.version > selection.appliedPlatformCourseVersion AND selection.notifiedPlatformCourseVersion IS DISTINCT FROM platformCourse.version`

## Migration

New file `apps/api/drizzle/0106_course_marketplace_updates.sql` (next available number, research.md §9):

- `ALTER TABLE platform_courses ADD COLUMN version integer NOT NULL DEFAULT 1;`
- `ALTER TABLE marketplace_selections ADD COLUMN applied_platform_course_version integer NOT NULL DEFAULT 1;`
- `ALTER TABLE marketplace_selections ADD COLUMN notified_platform_course_version integer;`
- `ALTER TABLE marketplace_selections ADD COLUMN dismissed_platform_course_version integer;`
- `ALTER TABLE course_modules ADD COLUMN source_platform_course_module_id uuid REFERENCES platform_course_modules(id) ON DELETE SET NULL;`
- `ALTER TABLE content_items ADD COLUMN source_platform_course_content_item_id uuid REFERENCES platform_course_content_items(id) ON DELETE SET NULL;`
- Supporting indexes on both new `source_...` columns.
- **Backfill** (one-time, this migration only): for every existing `fulfilled` `marketplace_selections`
  row, `applied_platform_course_version` defaults to `1` via the column default, which is correct only if
  every existing platform course is also still at `version = 1` at migration time (true, since `version`
  is introduced by this same migration at default `1` for every row). No existing tenant clone is
  falsely flagged "update available" the moment this migration lands — every pre-existing platform
  course and every pre-existing fulfilled selection start in sync at version 1. Pre-existing
  `course_modules`/`content_items` rows that were cloned before this spec keep
  `source_platform_course_module_id`/`source_platform_course_content_item_id` as `NULL` (not
  backfillable — the original clone never recorded which platform row it came from). This is flagged,
  not silently patched: the first time a Super Admin edits a platform course that has pre-existing
  clones from before this migration, "apply update" will not find a matching tenant row for any of that
  clone's *original* modules/content-items (since their `source_...` columns are `NULL`), so it will
  insert them again as if new rather than updating in place — for a clone made before this feature
  shipped, the first applied update after this spec ships may duplicate pre-existing curriculum rather
  than cleanly reconciling it. Acceptable one-time transitional cost given the codebase has no
  production tenants yet (dev/staging data only); called out here rather than silently accepted so it is
  visible if that assumption ever stops being true before this ships.

## Unchanged from spec 029 (referenced, not modified)

- `platform_course_modules`, `platform_course_content_items`, `platform_file_attachments` — no column
  changes. `platform_file_attachments` gains only a behavioral rule (research.md §3: objects are never
  deleted once a fulfilled selection exists for the owning course), not a schema change.
- `courses`, `file_attachments` — no column changes. `file_attachments.storage_key`'s uniqueness
  constraint was already dropped in spec 029 (migration `0102`) specifically to allow this kind of
  sharing; nothing further needed here.
