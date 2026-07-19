# Data Model: Learner Progress & Attempt Tracking

All tables live in the shared Postgres schema (shared schema + RLS isolation model, unchanged —
research.md §1). This spec introduces **one new table** (`learner_content_progress`). No existing table
is altered.

## New table: `learner_content_progress`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK, default random | |
| `tenant_id` | `uuid`, not null, FK → `tenants.id` | |
| `user_id` | `uuid`, not null, FK → `users.id` | the learner; always derived from the authenticated session on write, never client-supplied (research.md §3) |
| `content_item_id` | `uuid`, not null | **No database-level FK** — resolved via the caller's own tenant-scoped fetch first, mirrors `file_attachments.entity_id` (research.md §1). Avoids both an unwanted `RESTRICT` (blocking content-item deletion) and an unwanted `CASCADE` (silently destroying learner history). |
| `status` | `text`, not null, default `'not_started'` | `CHECK (status IN ('not_started', 'in_progress', 'completed', 'failed'))`. Freely settable on every update — no transition validation (spec Clarifications, Session 2026-07-19, Q1). |
| `score_raw` / `score_min` / `score_max` | `numeric`, nullable | any subset may be set; a provided `scoreRaw` is validated against provided bounds only when both bounds are also provided (research.md §6) |
| `bookmark` | `text`, nullable | free-form resume-position marker (video timestamp, scroll position, SCORM `cmi.core.lesson_location`); replaced wholesale on each update |
| `suspend_data` | `text`, nullable | free-form blob, **max 4096 characters** (FR-005), validated in application code (research.md §7); replaced wholesale on each update |
| `session_time_seconds` | `integer`, not null, default `0` | stores only the most recent update's input value — never accumulated itself; `total_time_seconds` is the running sum |
| `total_time_seconds` | `integer`, not null, default `0` | accumulated server-side: `total_time_seconds = total_time_seconds + $sessionTimeSeconds` on every update (FR-006) |
| `entered_at` | `timestamptz`, not null, default now | set once, at row creation; never modified by later updates (FR-007) |
| `exited_at` | `timestamptz`, not null, default now | advanced to now on every update (FR-007) |
| `updated_at` | `timestamptz`, not null, default now | advanced to now on every update |

**Constraints**:
- `status` `CHECK` as above.
- Unique on `(tenant_id, user_id, content_item_id)` — the single-current-row invariant (FR-002, SC-004);
  every write is an upsert against this key (research.md §2).

**Isolation**: RLS enabled + forced, standard hardened `tenant_isolation` policy, same migration sequence
as every prior tenant table.

**Indexes**:
- Unique index backing `(tenant_id, user_id, content_item_id)` (doubles as the upsert conflict target).
- `index("learner_content_progress_tenant_id_content_item_id_idx").on(tenantId, contentItemId)` — backs
  the manager-review-by-course query (joins through `content_items`/`course_modules`, research.md §5).

**Validation rules** (application layer, `progress-validation.ts`):
- `status` required on every write; must be one of the four fixed values.
- If `scoreRaw` and both `scoreMin`/`scoreMax` are all provided, `scoreMin <= scoreRaw <= scoreMax` —
  rejected (`400`) otherwise. Any other combination/omission of the three score fields is valid.
- `suspendData`, if provided, MUST be ≤ 4096 characters — rejected (`400`) otherwise, before any query
  runs.
- The target content item must resolve via `request.tenantDb` in the caller's own tenant — `404`
  otherwise (RLS makes a cross-tenant id simply not found).

**State transitions**: None enforced — `status` is freely settable to any of the four values on any
update, including regressing from a terminal value (spec Clarifications, Session 2026-07-19, Q1). No
archival/soft-delete state exists; this spec defines no delete operation for a progress row at all (not
in scope — see spec Assumptions).

---

## Relationships

```
tenants          1──* learner_content_progress   (new)
users             1──* learner_content_progress   (new: user_id, real FK — the learner)
content_items     1──* learner_content_progress   (new, loosely coupled via content_item_id — no DB FK)
course_modules    (joined only, not referenced directly) — via content_items.module_id, for curriculum-order reads (research.md §5)
```

No change to `permissions` — this spec adds zero rows there (reuses `course.view`/`course.manage`,
research.md §3/§4).

## Derived concepts (not columns — computed at request time)

- **Own progress on a content item** (spec FR-008): `SELECT * FROM learner_content_progress WHERE
  tenant_id = :tenant AND user_id = :caller AND content_item_id = :contentItemId` (RLS-scoped). Absence
  is represented to the client as a synthetic "not started" response, not a `404`.
- **Own whole-course progress, curriculum-ordered** (spec FR-009): `SELECT lcp.* FROM
  learner_content_progress lcp JOIN content_items ci ON ci.id = lcp.content_item_id JOIN course_modules
  cm ON cm.id = ci.module_id WHERE lcp.tenant_id = :tenant AND lcp.user_id = :caller AND ci.course_id =
  :courseId ORDER BY cm.position, ci.position`. Only rows that exist are returned (research.md §5).
- **Course-wide review, all learners** (spec FR-011): the same join as above without the `user_id`
  filter, additionally joined to `users` for a display name, gated by
  `requireAnyPermission("course.view", "course.manage")` (research.md §4).
