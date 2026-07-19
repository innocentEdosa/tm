# Feature Specification: Learner Progress & Attempt Tracking

**Feature Branch**: `026-learner-progress-tracking`

**Created**: 2026-07-19

**Status**: Draft

**Input**: User description: "Learner Progress & Attempt Tracking — generic, tenant-scoped, per-learner progress tracking on course content items for the TM multi-tenant SaaS, the second of two prerequisite specs (File Upload & Storage already shipped as spec 025; this one next) needed before a SCORM 1.2 Runtime spec can be built on top of both. Nothing in the schema today represents a learner being enrolled in or progressing through a course — this spec adds that. Scope: a single generic `learner_content_progress` entity keyed by (tenant, user, content_item) — one current-state row per learner per content item, continuously updated rather than a full attempt-history log (matches SCORM's typical resume-same-attempt LMS behavior and is simpler for non-SCORM content types where "attempts" isn't a natural concept). Fields: status (not_started/in_progress/completed/failed), score_raw/score_min/score_max (nullable, only meaningful for assessment/assignment/external_import types), bookmark (nullable text, a generic resume-position marker — e.g. video timestamp, scroll position, or SCORM's cmi.core.lesson_location), session_time and total_time (duration tracking), suspend_data (nullable text with a SCORM-1.2-sized cap of 4096 characters, for SCORM's arbitrary bookmark blob but usable generically), entered_at/exited_at/updated_at. This is a generic entity covering all 6 existing content-item types (video, text, article, assessment, assignment, external_import from spec 024) — simple types (video/text/article) primarily use status+time, assessment/assignment can optionally set a score, external_import/scorm will eventually use the fuller field set once the SCORM spec exists. No enrollment gate: any tenant user with course.view access can begin tracking progress on any course's content items (no separate enrollment/assignment record required — enrollment via Learning Request/Training Need Analysis/Learning Plan is explicitly out of scope, flagged future work, matching course.md's original "courses would later be tied to learning request..." framing from spec 023). Permissions: no new dedicated permission keys — a learner can create/update ONLY their own progress row (self-service, gated by simple authentication/ownership, not course.view/course.manage, since it's the learner's own activity not a course-management action); reading progress is gated by course.view or course.manage for viewing ANY learner's progress on that course (manager/reporting oversight), while a learner can always read their own row regardless of course.view/course.manage. API surface only, no UI — same pattern as specs 023/024/025: routes to start-or-update a learner's own progress on a content item (status/score/bookmark/time/suspend_data), read a learner's own progress for a content item or whole course, and read any/all learners' progress on a course (manager view) for reporting. Explicitly out of scope for this spec, to be documented as flagged future work: enrollment/assignment records (who is supposed to take what course); course/module-level completion rollup and certificates; attempt history/retake policies (multiple numbered attempts per content item); due dates, reminders, or notifications; reporting dashboards or aggregate analytics UI; any SCORM-specific RTE/API-object wiring (that belongs entirely to the SCORM Runtime spec, which will read/write this entity's fields but isn't built here)."

## Clarifications

### Session 2026-07-19

- Q: Should `status` transitions be validated (e.g. can't regress from `completed` back to `in_progress`), or can a caller freely set `status` to any value on any update? → A: Free-form — any status value is accepted on any update, no monotonicity enforced.
- Q: What order should a caller's whole-course progress read (User Story 2) return content items in? → A: Curriculum order — module position, then content-item position within module, matching spec 024's existing curriculum-read ordering.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Record my own progress on a content item (Priority: P1)

Any tenant user with access to view a course records or updates their own progress on one of its
content items — marking it in-progress or completed, saving a resume bookmark, optionally recording a
score, and accumulating time spent — without any separate enrollment step first.

**Why this priority**: Nothing else in this spec is useful without a way to write progress in the first
place — this is the foundational capability, and the entire reason this spec exists (it directly
unblocks the SCORM Runtime spec's own per-learner CMI state need).

**Independent Test**: As a user holding `course.view` on a course, submit a progress update for one of
its content items with a status and a bookmark, then verify a progress row now exists with those
values, `enteredAt` set, and `sessionTime` folded into `totalTime`.

**Acceptance Scenarios**:

1. **Given** a content item in a course the caller can view, **When** the caller submits their first
   progress update (status, and optionally score/bookmark/sessionTime/suspendData), **Then** a new
   progress row is created for that (caller, content item) pair with `enteredAt` set to now.
2. **Given** an existing progress row for (caller, content item), **When** the caller submits another
   update, **Then** the existing row is updated in place (not duplicated) — `status`/`bookmark`/
   `suspendData` are replaced with the submitted values, `sessionTime` submitted in this call is added
   to the row's running `totalTime`, and `exitedAt`/`updatedAt` advance to now.
3. **Given** a progress update that includes a score, **When** submitted, **Then** `scoreRaw` is
   accepted only alongside consistent `scoreMin`/`scoreMax` (raw within [min, max] when both bounds are
   provided); an inconsistent score is rejected.
4. **Given** a progress update targeting a content item id that doesn't resolve in the caller's tenant,
   **When** submitted, **Then** it is rejected as not found.
5. **Given** a user who lacks `course.view` on the course a content item belongs to, **When** they
   attempt to record progress on it, **Then** the request is rejected as forbidden.
6. **Given** a progress update whose `suspendData` exceeds 4096 characters, **When** submitted, **Then**
   it is rejected before any row is written or updated.

---

### User Story 2 - Read my own progress (Priority: P1)

A learner checks their own recorded progress on a single content item, or across every content item in
a course, so they can see what they've completed and resume where they left off.

**Why this priority**: Recording progress nobody can read back is unverifiable, and a learner resuming a
SCORM SCO or a bookmarked video depends on reading their own bookmark back; independently testable as
soon as User Story 1 can create data to read.

**Independent Test**: With a progress row already recorded for a content item, request that row back as
the same learner and confirm every field round-trips; request the whole course's progress and confirm
every content item the learner has touched appears, with untouched ones simply absent (not
error/zero-rows).

**Acceptance Scenarios**:

1. **Given** an existing progress row for (caller, content item), **When** the caller reads their own
   progress on that content item, **Then** the full row (status, score, bookmark, times, suspend data)
   is returned.
2. **Given** a content item the caller has never recorded progress on, **When** the caller reads their
   own progress on it, **Then** a "not started" response is returned rather than a not-found error.
3. **Given** a course with several content items, some touched and some not, **When** the caller reads
   their own whole-course progress, **Then** every touched content item's row is returned, ordered by
   curriculum position (module order, then content-item order within module), and untouched ones are
   simply absent from the list.
4. **Given** a caller who has since lost `course.view` on a course they previously recorded progress in,
   **When** they read their own progress on it, **Then** it is still returned — reading one's own
   progress does not depend on `course.view`/`course.manage`.

---

### User Story 3 - Review learners' progress on a course (Priority: P2)

An L&D admin or manager holding `course.view` or `course.manage` reviews every learner's progress on a
course's content items, for oversight and reporting purposes.

**Why this priority**: Valuable once individual progress-recording exists, but the platform is still
useful with only self-service recording/reading in the short term; this closes the loop for anyone other
than the learner themself.

**Independent Test**: With two different learners each having recorded progress on the same course, read
that course's progress as a third user holding only `course.view` and confirm both learners' rows are
visible.

**Acceptance Scenarios**:

1. **Given** a course with progress recorded by multiple learners, **When** a user holding `course.view`
   or `course.manage` reads that course's progress, **Then** every learner's progress row across the
   course's content items is returned, identified by learner.
2. **Given** a course nobody has recorded any progress on yet, **When** its progress is reviewed,
   **Then** an empty list is returned, not an error.
3. **Given** a course id belonging to a different tenant, **When** its progress is reviewed, **Then** the
   request is rejected as not found.
4. **Given** a user holding neither `course.view` nor `course.manage`, **When** they attempt to review
   another learner's progress (on a specific content item or a whole course), **Then** the request is
   rejected as forbidden.

---

### Edge Cases

- What happens when a learner submits a progress update with `status: "completed"` but no score, for a
  content item type where a score would normally be expected (assessment/assignment)? Accepted — score
  is always optional at this layer; enforcing "a score is required to complete an assessment" is a
  future policy layer, not this spec's concern (see Assumptions).
- What happens when a learner submits a progress update that would regress `status` (e.g. from
  `completed` back to `in_progress`, or from `failed` to `not_started`)? Accepted — `status` transitions
  are not validated or made monotonic in this spec; the caller's most recent submission always wins (see
  Clarifications).
- What happens when two updates for the same (learner, content item) arrive concurrently? Last write
  wins; no optimistic-concurrency/version check exists in this spec (see Assumptions).
- What happens when the content item's owning course or module is deleted after progress has been
  recorded against it? Out of scope for this spec to define — content items are not currently deletable
  in a way that leaves orphaned progress rows automatically cleaned up; flagged as a gap consistent with
  spec 025's own file-attachment orphan-cleanup note.
- What happens when a learner reads their own progress on a content item belonging to a different
  tenant? Rejected as not found — self-access still respects tenant isolation.
- What happens when `sessionTime` is submitted as zero or omitted? Treated as zero — `totalTime` is
  unchanged by that call, but `status`/`bookmark`/`suspendData`/score updates still apply.
- What happens when a request omits authentication entirely? Rejected as unauthorized, before any
  ownership or permission check runs.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow any authenticated tenant user holding `course.view` (or `course.manage`)
  on a content item's course to create or update their own progress row for that content item, given at
  minimum a `status`.
- **FR-002**: System MUST treat a progress update for a (caller, content item) pair with no existing row
  as a create (setting `enteredAt` to now), and a progress update for a pair with an existing row as an
  in-place update (never creating a second row for the same pair) — enforced by a uniqueness constraint
  on (tenant, user, content item).
- **FR-003**: System MUST accept an optional `score` (raw/min/max) on any progress update, and MUST
  reject a submitted score where `scoreRaw` falls outside a provided `[scoreMin, scoreMax]` range;
  `score` fields MUST remain nullable — omitting them entirely is always valid.
- **FR-004**: System MUST accept an optional `bookmark` (a free-form resume-position marker) on any
  progress update, replacing any previously stored value.
- **FR-005**: System MUST accept an optional `suspendData` (free-form text, maximum 4096 characters) on
  any progress update, replacing any previously stored value; a submission exceeding 4096 characters
  MUST be rejected before any row is written or updated.
- **FR-006**: System MUST accept an optional `sessionTime` on any progress update representing time spent
  in that single update call, and MUST add it to the row's running `totalTime` rather than replacing
  `totalTime` outright; omitting `sessionTime` MUST leave `totalTime` unchanged.
- **FR-007**: System MUST update `exitedAt` and `updatedAt` to the current time on every progress update,
  while leaving the original `enteredAt` from the row's creation untouched by subsequent updates.
- **FR-008**: System MUST allow a caller to read their own progress row for a specific content item, and
  MUST return a "not started" result (not an error) when no row yet exists for that pair.
- **FR-009**: System MUST allow a caller to read all of their own progress rows for every content item
  in a given course in a single request, returning only rows that exist (untouched content items are
  simply absent, not represented as empty/placeholder rows), ordered by curriculum position (module
  order, then content-item order within module, matching spec 024's curriculum-read ordering).
- **FR-010**: System MUST allow a caller to read their own progress (single content item or whole
  course) regardless of whether they currently hold `course.view`/`course.manage` on that course — this
  self-access path is gated only by the row belonging to the caller, not by course-level permission.
- **FR-011**: System MUST allow users holding `course.view` or `course.manage` to read every learner's
  progress across a course's content items, identified by learner, for reporting/oversight purposes.
- **FR-012**: System MUST reject a progress-review request (User Story 3) from a user holding neither
  `course.view` nor `course.manage` on the target course, as forbidden.
- **FR-013**: System MUST scope every progress row and every progress operation to the requesting user's
  own tenant, server-side, regardless of any tenant identifier the client supplies; requests targeting a
  content item or course id in another tenant MUST be rejected as not found.
- **FR-014**: System MUST NOT require a separate enrollment or assignment record to exist before a
  learner can record progress on a course's content items — access is governed solely by `course.view`
  at write time (FR-001) and by row ownership thereafter (FR-010); enrollment/assignment is explicitly
  out of scope (see Assumptions).
- **FR-015**: System MUST NOT retain a history of multiple attempts per (learner, content item) in this
  feature — each pair has exactly one current-state row, continuously overwritten by updates; a
  full attempt-history log is explicitly deferred future work.
- **FR-016**: System MUST NOT compute or expose course/module-level completion rollup, certificates, due
  dates, reminders, or aggregate reporting/analytics in this feature — explicitly deferred future work,
  to be built on top of this entity by a future spec.
- **FR-017**: System MUST NOT validate or enforce `status` transitions — a caller MAY set `status` to any
  of the four values on any update, including regressing from a terminal value (`completed`/`failed`)
  back to a non-terminal one; the most recently submitted value always wins.

### Key Entities *(include if feature involves data)*

- **Learner Content Progress**: A tenant-scoped record representing one learner's current progress on
  one content item — exactly one row per (tenant, user, content item), continuously updated rather than
  historized. Attributes: status (`not_started` / `in_progress` / `completed` / `failed`), an optional
  score (raw/min/max, meaningful only for gradable content types), an optional free-form bookmark
  (resume-position marker), an optional free-form suspend-data blob (capped at 4096 characters), session
  time (per-update input) folded into an accumulating total time, and timestamps (`enteredAt` — set once
  at creation, `exitedAt`/`updatedAt` — advanced on every update). Belongs to exactly one tenant, one
  user, and one content item (spec 024), with no database-level foreign key enforcement on the content
  item beyond tenant scoping being required by this spec (matching the loose-coupling precedent already
  used for attachments in spec 025, since this entity must equally tolerate future non-content-item
  progress subjects without a schema change being assumed here). Has no relationship to enrollment
  records, attempt history, or certificates in this spec — all explicitly deferred.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A learner can resume a partially-completed content item using only their own saved
  bookmark/suspend-data, with no data loss from the previous session, on 100% of resumed sessions in
  automated testing.
- **SC-002**: 100% of progress-read and progress-review requests targeting a content item, course, or
  progress row belonging to a different tenant are rejected, verified by automated test.
- **SC-003**: 100% of progress-write requests from users lacking `course.view` on the target course, and
  100% of progress-review requests from users lacking `course.view`/`course.manage`, are rejected,
  verified by automated test.
- **SC-004**: A learner never accumulates more than one progress row per content item, regardless of how
  many times they submit updates, verified by automated test.
- **SC-005**: A learner retains read access to their own historical progress even after losing
  `course.view` on the owning course, verified by automated test.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: No change to the isolation model — the progress table follows the
  existing shared-schema-with-`tenant_id`-scoping pattern (Principle I), with RLS enforced the same way
  as every other tenant-scoped table in this codebase.
- **Tenant-configurable vs. fixed platform-wide**: No new permission keys — write access reuses
  `course.view` (any viewer may record their own progress) and review access reuses `course.view`/
  `course.manage`, matching the delegation pattern already used by spec 025. The status vocabulary
  (`not_started`/`in_progress`/`completed`/`failed`) is fixed platform-wide, not tenant-configurable.
- **AI-generation review/approval step**: N/A — this spec stores learner-submitted progress state; it
  generates no AI content.
- **Kirkpatrick L4/L5 data source & formula**: N/A — this spec tracks per-content-item completion state,
  not organizational Results/ROI data; a future reporting/analytics spec would be the place to define
  any Kirkpatrick-level rollup sourced from this entity.
- **Downgrade/cancellation behavior**: N/A — this feature carries no plan-tier or storage-quota
  dimension of its own.
- **Design system reference**: N/A — this spec ships no UI; it is API/data-model only, matching specs
  023/024/025's own scope pattern.
- **Demoable vs. internal**: Internal/infrastructure-only. Demoable only via direct API calls (record a
  progress update, read it back) — not to a non-technical stakeholder until a future learner-facing UI
  spec exists (the SCORM launcher spec is the first to need one).

## Assumptions

- **On the Input section's phrasing** ("gated by simple authentication/ownership, not
  `course.view`/`course.manage`"): that phrase means write access does not require the *stricter*
  `course.manage` permission — not that it requires no permission at all. FR-001 is the authoritative
  requirement: write access requires `course.view` (or `course.manage`), reusing existing visibility
  rather than a new permission key (`/speckit-analyze` finding F1).
- Enrollment/assignment (who is supposed to take what course, sourced from a future Learning Request,
  Training Need Analysis, or Learning Plan spec, per spec 023's original framing) does not exist yet.
  This spec deliberately does not gate progress-recording on it — any `course.view` holder can record
  progress on any course's content items today. A future enrollment spec MAY tighten this gate; that
  tightening is out of scope here and must not be assumed to already exist.
- "A score is required to mark an assessment/assignment complete" and any other content-type-specific
  completion policy is explicitly NOT enforced by this spec — `score` is optional on every update
  regardless of the content item's type. Enforcing such policy is future work, likely belonging to
  whatever spec eventually builds assessment/assignment-taking flows themselves.
- No optimistic-concurrency or versioning exists on a progress row in this spec — concurrent updates to
  the same (learner, content item) pair use last-write-wins semantics.
- No automatic cleanup of a progress row when its owning content item, module, or course is deleted
  exists in this spec — explicitly deferred future work, matching spec 025's own equivalent gap for file
  attachments.
- This is an API-only feature — no web UI ships as part of this spec, matching specs 023/024/025's own
  scope pattern. The first UI-bearing spec in this sequence will be the SCORM Runtime launcher.
- No new external dependency or paid service is required for this spec — it is pure database + API
  surface, unlike spec 025's storage dependency.
