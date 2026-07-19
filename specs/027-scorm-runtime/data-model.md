# Data Model: SCORM 1.2 Runtime

All tables live in the shared Postgres schema (shared schema + RLS isolation model, unchanged —
research.md §8). This spec introduces **four new tables**. `content_items` (spec 024) is read/written by
this spec's routes but its own schema is not altered. `learner_content_progress` (spec 026) gains **one
new nullable column**, `scorm_raw_lesson_status` (text) — SCORM 1.2's `cmi.core.lesson_status` has six
values (`passed`/`completed`/`failed`/`incomplete`/`browsed`/`not attempted`), which that table's own
4-value `status` CHECK cannot losslessly represent (`passed` and `completed` would otherwise collapse
together); this column stores the exact raw value for lossless resume, while `status` continues to hold
the derived 4-value mapping spec 026's own review/rollup logic already relies on. Purely additive —
unused by, and invisible to, every non-SCORM content type or route.

## New table: `scorm_packages`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK, default random | |
| `tenant_id` | `uuid`, not null, FK → `tenants.id` | |
| `title` | `text`, nullable | from the manifest's `<organization><title>`, for display |
| `created_by_user_id` | `uuid`, nullable, FK → `users.id`, `ON DELETE SET NULL` | |
| `created_at` | `timestamptz`, not null, default now | |

**Isolation**: RLS enabled + forced, standard hardened `tenant_isolation` policy.

## New table: `scorm_package_items`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK, default random | |
| `tenant_id` | `uuid`, not null, FK → `tenants.id` | |
| `package_id` | `uuid`, not null, FK → `scorm_packages.id`, `ON DELETE CASCADE` | |
| `content_item_id` | `uuid`, not null, FK → `content_items.id`, `ON DELETE CASCADE`, **unique** | real FK — created in the same transaction as its content item (research.md §8), unlike `file_attachments`/`learner_content_progress`'s deliberately loose coupling |
| `manifest_item_identifier` | `text`, not null | the manifest `<item identifier="...">` value, for traceability |
| `entry_point_relative_path` | `text`, not null | the SCO's resolved entry-point file path, relative to the package root — used to construct the file-proxy iframe `src` |
| `position` | `integer`, not null | package-scoped order (0-indexed) for previous/next navigation (FR-013) — distinct from `content_items.position`, which is module-wide and may include non-package siblings |

**Constraints**: unique on `content_item_id`. Unique on `(package_id, position)`.

**Isolation**: RLS enabled + forced, standard hardened `tenant_isolation` policy.

**Indexes**: `index("scorm_package_items_tenant_id_package_id_idx").on(tenantId, packageId)` — backs the
previous/next navigation query.

## New table: `scorm_cmi_objectives`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK, default random | |
| `tenant_id` | `uuid`, not null, FK → `tenants.id` | |
| `user_id` | `uuid`, not null, FK → `users.id` | |
| `content_item_id` | `uuid`, not null | **no FK** — mirrors `learner_content_progress.contentItemId`'s loose coupling (this row's lifecycle should follow the learner's progress record, not the content item directly) |
| `objective_index` | `integer`, not null | the `n` in `cmi.objectives.n.*` |
| `objective_id` | `text`, nullable | `cmi.objectives.n.id` |
| `status` | `text`, nullable | `cmi.objectives.n.status` — not `CHECK`-constrained (research.md §9) |
| `score_raw` / `score_min` / `score_max` | `numeric(12,4)`, nullable | `cmi.objectives.n.score.*` |

**Constraints**: unique on `(tenant_id, user_id, content_item_id, objective_index)`.

**Isolation**: RLS enabled + forced, standard hardened `tenant_isolation` policy.

## New table: `scorm_cmi_interactions`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK, default random | |
| `tenant_id` | `uuid`, not null, FK → `tenants.id` | |
| `user_id` | `uuid`, not null, FK → `users.id` | |
| `content_item_id` | `uuid`, not null | **no FK**, same rationale as `scorm_cmi_objectives` |
| `interaction_index` | `integer`, not null | the `n` in `cmi.interactions.n.*` |
| `interaction_id` | `text`, nullable | `cmi.interactions.n.id` |
| `type` | `text`, nullable | `cmi.interactions.n.type` |
| `weighting` | `numeric(12,4)`, nullable | `cmi.interactions.n.weighting` |
| `student_response` | `text`, nullable | `cmi.interactions.n.student_response` |
| `result` | `text`, nullable | `cmi.interactions.n.result` |
| `latency` | `text`, nullable | `cmi.interactions.n.latency` (SCORM's own `HH:MM:SS.SS` string format, stored as-is) |
| `correct_responses` | `jsonb`, nullable | `cmi.interactions.n.correct_responses.*` — an array, since SCORM allows multiple correct-response patterns per interaction |

**Constraints**: unique on `(tenant_id, user_id, content_item_id, interaction_index)`.

**Isolation**: RLS enabled + forced, standard hardened `tenant_isolation` policy.

---

## Relationships

```
tenants               1──* scorm_packages          (new)
tenants               1──* scorm_package_items      (new)
tenants               1──* scorm_cmi_objectives     (new)
tenants               1──* scorm_cmi_interactions   (new)
users                 0..1──* scorm_packages         (new: created_by_user_id, ON DELETE SET NULL)
users                  1──* scorm_cmi_objectives      (new)
users                  1──* scorm_cmi_interactions    (new)
scorm_packages         1──* scorm_package_items       (new, real FK, ON DELETE CASCADE)
content_items          1──1 scorm_package_items       (new, real FK, ON DELETE CASCADE — one SCO per content item)
content_items          1──* learner_content_progress  (existing, spec 026 — reused directly for core CMI fields)
content_items          1──* scorm_cmi_objectives      (new, loosely coupled — no DB FK, mirrors spec 026's own convention)
content_items          1──* scorm_cmi_interactions    (new, loosely coupled — no DB FK)
```

No change to `permissions` — this spec adds zero rows there (reuses `course.manage`/`course.view`,
research.md).

## Derived concepts (not columns — computed at request time)

- **Launch data** (spec FR-005/FR-011): joins the target content item's `learner_content_progress` row
  (spec 026, or the synthetic "not started" default), its `scorm_cmi_objectives`/`scorm_cmi_interactions`
  rows, its `scorm_package_items` row (for `entryPointRelativePath` + `packageId`), and every sibling
  `scorm_package_items` row sharing the same `packageId` ordered by `position` (for previous/next nav).
- **CMI commit** (spec FR-007/FR-008): one transaction that upserts the `learner_content_progress` row
  (reusing spec 026's exact upsert logic) and replaces (`DELETE` then bulk `INSERT`, simplest correct
  approach for a small, fully-replaced array) the caller's `scorm_cmi_objectives`/`scorm_cmi_interactions`
  rows for that content item.
- **File-proxy key derivation** (research.md §7): `{tenantId}/scorm/{packageId}/{relativePath}` —
  computed directly from the request's own params/session, no database lookup.
