# Research: Learner Progress & Attempt Tracking

## 1. New table: `learner_content_progress`, one current-state row per (tenant, user, content item)

**Decision**: One new table, unique on `(tenant_id, user_id, content_item_id)`. `content_item_id` is a
plain `uuid` column with **no database-level foreign key** to `content_items` — every write/read
resolves the content item through a tenant-scoped query first, the same "caller's own tenant-scoped
fetch is the safety net" pattern already established for `file_attachments.entity_id` (spec 025) and
`custom_field_values.entity_id`.

**Rationale**: `content_items` supports hard delete (spec 024's `DELETE /tenant/content-items/:id`), and
a real `RESTRICT` FK would block deleting a content item that any learner had ever touched — clearly
wrong. A real `CASCADE` FK would silently wipe learner history the moment an admin deletes/reorganizes
content, which is also wrong for a record that's meant to represent what a learner actually did. No FK
sidesteps both failure modes at the cost of the same orphan-tolerance gap spec 025 already accepted and
named as follow-up work for its own polymorphic table.

**Alternatives considered**:
- A real FK with `ON DELETE CASCADE` — rejected: silently destroys a learner's own history as a side
  effect of an unrelated content edit, which is a worse failure mode than a tolerated orphan.
- A real FK with `ON DELETE RESTRICT` — rejected: would make any content item any learner has ever
  touched permanently undeletable, which contradicts spec 024's own content-item delete capability.

## 2. Single current-state row, not attempt history (spec's own explicit decision, restated for the record)

**Decision**: Enforce the `(tenant_id, user_id, content_item_id)` uniqueness with a database constraint;
every write is an upsert (`INSERT ... ON CONFLICT ... DO UPDATE`), never a plain `INSERT`.

**Rationale**: Directly implements spec FR-002 and SC-004 ("a learner never accumulates more than one
progress row per content item"). An upsert is also the natural primitive for FR-006's accumulating
`totalTime` semantics (`total_time = total_time + $sessionTime` inside the same `ON CONFLICT` clause,
rather than a read-then-write race).

**Alternatives considered**:
- Application-layer "check if exists, then INSERT or UPDATE" — rejected: a genuine TOCTOU race under
  concurrent requests for the same (user, content item) pair, which `ON CONFLICT` avoids for free at the
  database layer.

## 3. Write authorization: `course.view` (or `course.manage`) required, write always scoped to self

**Decision**: `PUT /tenant/content-items/:contentItemId/progress` requires
`requireAnyPermission("course.view", "course.manage")`, exactly like spec 024/025's own read-oriented
routes. The row written is always `request.user!.id` — there is no request field or route parameter that
lets a caller write progress for anyone but themselves; "self" is derived from the session, never
client-supplied.

**Rationale**: Directly implements spec FR-001 ("any authenticated tenant user holding `course.view`
... on a content item's course") and the spec's explicit self-service framing — the caller can never
target a different `userId`. Reusing `course.view` (rather than requiring `course.manage`) keeps this
consistent with the spec's "no enrollment gate" decision: anyone who can already *see* a course can
record progress on it.

**Alternatives considered**:
- Requiring `course.manage` for write — rejected: contradicts FR-001 explicitly and would make progress-
  recording an editorial action rather than a learner's own activity, which is the opposite of what this
  spec is for.
- No permission check at all for write (any authenticated tenant user, even without `course.view`) —
  rejected: contradicts FR-001's explicit wording and the spec's Scope framing ("any tenant user with
  `course.view` access can begin tracking progress"), which ties write access to the same visibility a
  learner already needs to discover the course exists.

## 4. Read authorization: self-read is ownership-only; course-wide review requires `course.view`/`course.manage`

**Decision**: `GET /tenant/content-items/:contentItemId/progress` and
`GET /tenant/courses/:courseId/progress` (both "read my own") require only `requireTenantUserSession()`
— no permission preHandler — then filter to `userId = request.user!.id` server-side, never client-
supplied. `GET /tenant/courses/:courseId/progress/learners` (the manager review route) requires
`requireAnyPermission("course.view", "course.manage")` and returns every learner's rows for that course.

**Rationale**: Directly implements FR-010 (a learner keeps read access to their own history even after
losing `course.view`) and FR-011/FR-012 (course-wide review is permission-gated). This is the first route
in this spec sequence where "authenticated" alone (not any permission key) is a sufficient and correct
gate — a deliberate, spec-mandated deviation from every prior route in specs 023/024/025, not an
oversight.

**Alternatives considered**:
- Gating self-read behind `course.view` too, for consistency with every other route in this codebase —
  rejected outright: directly contradicts FR-010, which was arrived at through explicit scoping
  (AskUserQuestion) specifically to keep a learner's own history visible to them regardless of later
  permission changes.

## 5. Curriculum-order reads: join through `courseModules`/`contentItems` position columns

**Decision**: `GET /tenant/courses/:courseId/progress` orders results by `courseModules.position` then
`contentItems.position` (both already exist, spec 024), via a join from `learner_content_progress` to
`content_items` to `course_modules` — not by any column on `learner_content_progress` itself.

**Rationale**: Directly implements the `/speckit-clarify` decision (Session 2026-07-19, Q2) and FR-009,
matching the exact ordering `course-content`'s own curriculum-read endpoint already uses, so a course's
progress view lines up with the same order a learner sees when browsing the course.

**Alternatives considered**:
- Denormalizing a `position` onto `learner_content_progress` at write time — rejected: would go stale the
  moment a module/content item is reordered after progress was recorded, exactly the kind of denormalized
  drift the join approach avoids for free.

## 6. Score validation: consistency check only, no external source of truth for min/max

**Decision**: A small validation helper (`progress-validation.ts`) rejects a write where
`scoreRaw` is provided alongside both `scoreMin` and `scoreMax` and falls outside `[scoreMin, scoreMax]`.
Any subset of the three fields (just `scoreRaw`, or `scoreRaw` + one bound, or none at all) is valid —
consistent with FR-003's "score fields MUST remain nullable — omitting them entirely is always valid."

**Rationale**: Nothing in this codebase today defines a canonical max score for an assessment/assignment
content item (spec 024's `content_items.payload` is free-form JSON with no formalized scoring rubric), so
`scoreMin`/`scoreMax` can only be self-reported by the caller alongside `scoreRaw` in this spec — there is
no other source of truth to validate against yet.

**Alternatives considered**:
- Requiring all three score fields together or none — rejected: unnecessarily strict for content types
  (e.g. a simple pass/fail assignment) where only a raw score might be meaningful without bounds.

## 7. `suspendData` length cap: enforced in the same validation helper, not a database `CHECK`

**Decision**: The 4096-character cap (FR-005) is enforced in `progress-validation.ts` before any query
runs, returning a clean `400`, rather than as a database `CHECK` constraint that would surface as an
opaque constraint-violation error.

**Rationale**: Matches this codebase's existing convention (e.g. spec 024's `content_item_payload-
validation.ts`) of validating shape/size in application code so the client gets a clear `400` with a
useful message, reserving database `CHECK` constraints for invariants the application layer cannot
realistically bypass (like the fixed status/entity-type enums).

**Alternatives considered**:
- A database `CHECK (length(suspend_data) <= 4096)` — rejected: would produce a raw Postgres constraint
  error instead of a clean validation response, inconsistent with how every other length/shape rule in
  this codebase is enforced.

## 8. No new dependency, no new test-fixture pattern

**Decision**: This spec needs nothing beyond what specs 023/024 already use — Fastify, Drizzle, Vitest
integration tests against real local Postgres via `server.inject`. No adapter/interface/test-seam module
(unlike spec 025's `storage/`) because there is no external, network-dependent, credentialed service
involved anywhere in this spec.

**Rationale**: Per Constitution Principle XII, a new dependency or new abstraction is the fallback, not
the default — this spec has no problem shape that calls for either.

**Alternatives considered**: N/A — no dependency was ever a candidate.

## 9. No web UI, no route in `apps/web`

**Decision**: This spec adds zero files under `apps/web`, matching specs 023/024/025's own scope
boundary.

**Alternatives considered**: N/A — out of scope by explicit decision during spec scoping (the SCORM
launcher spec is the first in this sequence that requires a UI).
