# Feature Specification: Course Content

**Feature Branch**: `024-course-content`

**Created**: 2026-07-18

**Status**: Draft

**Input**: User description: "Course Content — content/curriculum authoring for the TM multi-tenant SaaS, the direct follow-up to the Course Creation spec (023), which deliberately deferred all content to this spec. Scope: courses are organized into modules (ordered sections within a course — title, description, position), and each module holds an ordered list of content items. Content items are polymorphic — a single content_items-style table with a type discriminator and a flexible per-type payload, as already flagged in spec 023's Clarifications — supporting six types: video (external URL/embed, e.g. YouTube/Vimeo — no native file upload in this spec), article (inline rich text/body stored directly, or an external URL to an already-hosted article), live class (scheduled datetime, facilitator, meeting link/location, optional capacity), test and assignment (both placeholder shells only — title, instructions/description, and for test a plain pass-criteria field; no question-authoring, no submission mechanism, no grading engine, no attempt tracking), and external import (e.g. a SCORM package or other externally-hosted course — represented as an external URL plus a source-type label; no manifest parsing, no upload, no runtime playback/completion API). This spec is authoring-only: create, edit, reorder, and remove modules and content items within a course; no learner-facing progress, completion, or scoring is tracked here. Native file upload (for video/article/SCORM packages) and full SCORM runtime support are explicitly out of scope for this spec and MUST be documented as flagged future work, not silently implied as already possible. API-only, no web UI, matching spec 023's own scope pattern. Permissions: reuse the existing course.view/course.manage granted at the course level (no new permission keys) unless clarification surfaces a real need to separate them. Every content item and module belongs to exactly one course (spec 023's courses table) and is tenant-scoped transitively through it."

## Clarifications

### Session 2026-07-18

- Q: Which content types should this first spec cover? → A: All six now — video, article, live class, test, assignment, external import — per Constitution Principle VIII (default to the more complete version), since all six share the same polymorphic content-item shell already flagged in spec 023.
- Q: How should video and article content be hosted? → A: External URL/embed only for this spec (e.g. a YouTube/Vimeo link for video, inline rich text or an external link for article). Native file upload with object storage is explicitly deferred to a future spec — a real infrastructure decision requiring its own dependency sign-off, not bundled here.
- Q: What does "imported from other sources" (e.g. SCORM) mean here? → A: An external link only — a content item pointing at an already-hosted package/course elsewhere, with a plain source-type label. No manifest parsing, no file upload, no in-browser runtime/completion-tracking API. Full SCORM/xAPI runtime support is explicitly deferred to a future spec.
- Q: How deep should Test/Assignment content go? → A: Placeholder shell only — title, instructions, and (for test) a plain pass-criteria text field. No question-authoring, no submission mechanism, no grading engine, no attempt tracking.
- Q: Should content be grouped into modules/sections, or a single flat list per course? → A: Modules/sections from the start — a new ordered `course_modules` grouping layer, with content items ordered within their module.
- Q: Is this spec authoring-only, or does it also track learner progress? → A: Authoring-only. Creating, editing, reordering, and removing modules/content items is in scope; learner-facing completion/score/attempt tracking is explicitly out of scope and deferred to a future spec.
- Q: Should create/move operations accept an explicit target position, or is placement append-only with reordering as a separate step? → A: Append-only. Creating a module/content item always appends it last (in its course/module); moving a content item to a different module always appends it last there too. The dedicated reorder action (FR-007) is the *only* way to place anything anywhere but last — one placement mechanism, not two competing ones.
- Q: Is moving a content item to a different module a field on the general update endpoint, or its own dedicated action? → A: Just a field on the general update endpoint — a content item's module membership changes like any other field edit (FR-006), not through a separate "move" action. One write path per entity, not two.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build a course's module structure (Priority: P1)

An L&D admin holding `course.manage` adds modules to a course — ordered sections like "Module 1:
Introduction," "Module 2: Advanced Topics" — establishing the top-level shape of the curriculum before
filling in content.

**Why this priority**: Nothing else in this spec is possible without a module to hold content items —
this is the foundational structural layer.

**Independent Test**: As a user holding `course.manage`, create three modules on an existing course and
confirm they appear in order, each appended after the last.

**Acceptance Scenarios**:

1. **Given** a course with no modules, **When** a user holding `course.manage` creates a module with a
   title, **Then** it is created as the course's first module, tenant-scoped, with audit fields
   recorded.
2. **Given** a course with two existing modules, **When** a third module is created, **Then** it is
   appended after the existing two without the caller needing to specify a position.
3. **Given** a create request targeting a course id that doesn't resolve in the caller's tenant,
   **When** submitted, **Then** it is rejected as not found.
4. **Given** a user holding only `course.view` (no `course.manage`), **When** they attempt to create a
   module, **Then** the request is rejected as forbidden.

---

### User Story 2 - Add content to a module (Priority: P1)

An L&D admin holding `course.manage` adds content items to a module — a video, an article, a scheduled
live class, a test or assignment shell, or a link to an externally-hosted course — building out what a
learner will eventually encounter in that section.

**Why this priority**: This is the actual payload of a curriculum; modules alone (User Story 1) hold
nothing a learner could use. Independently valuable and testable once a module exists.

**Independent Test**: As a user holding `course.manage`, add one content item of each of the six types
to a module and confirm each is created with its type-specific fields intact and appended in order.

**Acceptance Scenarios**:

1. **Given** a module, **When** a user holding `course.manage` creates a `video` content item with a
   URL, **Then** it is created and appended as the module's next item.
2. **Given** a module, **When** an `article` content item is created with either inline body text or an
   external URL, **Then** it is created successfully (at least one of the two is required).
3. **Given** a module, **When** a `live_class` content item is created with a scheduled date/time,
   **Then** it is created; facilitator, meeting link, and capacity are accepted as optional fields.
4. **Given** a module, **When** a `test` or `assignment` content item is created with a title and
   instructions, **Then** it is created as a placeholder shell — no question, submission, or grading
   fields are accepted or required.
5. **Given** a module, **When** an `external_import` content item is created with an external URL and a
   source-type label (e.g. "scorm"), **Then** it is created as a pointer only — no file is uploaded, no
   package is parsed.
6. **Given** a content item create request with an invalid `type` value, **When** submitted, **Then** it
   is rejected with a clear validation error.
7. **Given** a `video` content item create request missing its URL (or an `external_import` request
   missing its URL or source-type label), **When** submitted, **Then** it is rejected with a clear
   validation error identifying the missing field.
8. **Given** a user holding only `course.view`, **When** they attempt to create a content item, **Then**
   the request is rejected as forbidden.

---

### User Story 3 - Review a course's full curriculum (Priority: P1)

Anyone holding `course.view` or `course.manage` retrieves a course's complete curriculum — every
module in order, each with its content items in order — to review what's been built, or for a future
feature (Training Requests, TNA, Learning Plans) to display it.

**Why this priority**: A curriculum nobody can read back is unverifiable and unusable by this spec's own
future consumers; independently testable as soon as User Stories 1-2 can create data to read.

**Independent Test**: With a course that has multiple modules and a mix of content-item types, fetch its
full curriculum and confirm every module and item appears in the correct order with its correct
type-specific fields.

**Acceptance Scenarios**:

1. **Given** a course with modules and content items, **When** a user holding `course.view` requests
   its curriculum, **Then** every module is returned in order, each with its content items in order.
2. **Given** a course with zero modules, **When** its curriculum is requested, **Then** an empty list is
   returned, not an error.
3. **Given** a course id belonging to a different tenant, **When** any user requests its curriculum,
   **Then** the request is rejected as not found.
4. **Given** a user holding neither `course.view` nor `course.manage`, **When** they request a
   curriculum, module, or content item, **Then** the request is rejected as forbidden.

---

### User Story 4 - Keep the curriculum accurate and well-ordered (Priority: P2)

An L&D admin holding `course.manage` edits a module's or content item's fields as details change,
reorders modules within a course or content items within a module, and moves a content item to a
different module in the same course.

**Why this priority**: Curricula drift after first authoring (typos, a reschedule, reordering to
improve flow); materially useful once creation and read access exist, but the curriculum is usable
without it in the short term.

**Independent Test**: As a user holding `course.manage`, edit a content item's title, reorder a
course's three modules into a new sequence, and confirm both changes are reflected on the next
curriculum read.

**Acceptance Scenarios**:

1. **Given** an existing module or content item, **When** a user holding `course.manage` updates its
   fields (a content item's `type` itself cannot be changed — see Assumptions), **Then** the changes
   persist and audit fields refresh.
2. **Given** a course with three modules, **When** a user holding `course.manage` submits a new module
   order (the full list of module ids in the desired sequence), **Then** subsequent curriculum reads
   reflect that order.
3. **Given** a module with several content items, **When** a user holding `course.manage` submits a new
   item order for that module, **Then** subsequent reads reflect that order.
4. **Given** a content item, **When** a user holding `course.manage` updates its module membership to a
   different module within the same course (via the same general update operation as any other field
   edit, not a separate action), **Then** it appears under the new module, appended last, and no longer
   under its original module.
5. **Given** an update request with an invalid `type`-specific field (e.g. an invalid content-item
   field shape), **When** submitted, **Then** it is rejected with a validation error and no partial
   update occurs.
6. **Given** a content item, **When** a user holding `course.manage` attempts to update its module
   membership to a module belonging to a *different* course, **Then** the request is rejected with a
   validation error and the content item's module membership is unchanged (FR-008).
7. **Given** a user holding only `course.view`, **When** they attempt any edit or reorder, **Then** the
   request is rejected as forbidden.

---

### User Story 5 - Remove a module or content item (Priority: P2)

An L&D admin holding `course.manage` deletes a content item that's no longer needed, or an entire
module (removing every content item it holds).

**Why this priority**: Authoring inevitably includes correcting mistakes (a duplicate item, an
abandoned module); useful once creation exists, but not blocking for the curriculum to be usable.

**Independent Test**: As a user holding `course.manage`, delete a single content item and confirm it no
longer appears in the curriculum; delete a module with two content items in it and confirm both the
module and its items are gone.

**Acceptance Scenarios**:

1. **Given** a content item, **When** a user holding `course.manage` deletes it, **Then** it no longer
   appears in the course's curriculum.
2. **Given** a module containing content items, **When** a user holding `course.manage` deletes the
   module, **Then** the module and every content item it held are removed together.
3. **Given** a delete request targeting a module or content item id in a different tenant, **When**
   submitted, **Then** it is rejected as not found.
4. **Given** a user holding only `course.view`, **When** they attempt to delete a module or content
   item, **Then** the request is rejected as forbidden.

---

### Edge Cases

- What happens when a module is created on a course that doesn't exist (any tenant)? Rejected as not
  found, same response shape as a cross-tenant course id.
- What happens when a content item's type-specific payload includes fields not valid for its type
  (e.g. a `passCriteria` field on a `video` item)? Ignored/rejected at the validation layer — only the
  fields valid for the given `type` are accepted.
- What happens when a reorder request omits an id that currently exists, or includes one that doesn't
  belong to the course/module being reordered? Rejected with a validation error — a reorder must be a
  complete, exact permutation of the current set, never a partial or foreign list.
- What happens when an `article` content item is created with neither inline body text nor an external
  URL? Rejected — at least one is required.
- What happens when a course has zero modules, or a module has zero content items? Both return empty
  lists, not errors.
- What happens when a request omits authentication entirely? Rejected as unauthorized, before
  permission checks run.
- What happens when a create or move request includes a position/index field anyway? Silently ignored
  — placement is always append-last on create/move (Clarifications); a position field is not part of
  the accepted request shape for those operations.
- What happens when a content item's module-membership change targets a module belonging to a
  *different* course than the item's own? Rejected with a validation error (FR-008) — a content item
  may only move between modules of its own course, never across courses.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow users holding `course.manage` to create a module on an existing course
  with a required title and optional description, always appended as the course's last module — create
  requests MUST NOT accept an explicit target position; the dedicated reorder action (FR-007) is the
  only way to place a module anywhere but last.
- **FR-002**: System MUST allow users holding `course.view` or `course.manage` to retrieve a course's
  full curriculum — every module in order, each with its content items in order.
- **FR-003**: System MUST allow users holding `course.manage` to create a content item on an existing
  module, with a required `type` (one of `video`, `article`, `live_class`, `test`, `assignment`,
  `external_import`) and the required fields for that type, always appended as the module's last item —
  create requests MUST NOT accept an explicit target position, for the same reason as FR-001.
- **FR-004**: System MUST validate each content item's type-specific required fields at creation and
  update time: `video` requires a URL; `article` requires inline body text or an external URL (at least
  one); `live_class` requires a scheduled date/time; `external_import` requires an external URL and a
  source-type label; `test` and `assignment` require only a title (instructions/description optional,
  no question/submission/grading fields exist to validate).
- **FR-005**: System MUST reject a content item create/update request with a `type` value outside the
  fixed six-value enum, or with a type-specific field invalid for the given `type`.
- **FR-006**: System MUST allow users holding `course.manage` to update an existing module's or content
  item's fields through a single general update operation per entity — a content item's module
  membership (which module it belongs to) is just one such field, changed the same way as title or
  description, not through a separate action (see FR-008); a content item's `type` itself is immutable
  once created (see Assumptions).
- **FR-007**: System MUST allow users holding `course.manage` to reorder a course's modules, or a
  module's content items, by submitting a complete ordered list of ids; the system MUST reject a reorder
  request whose id set does not exactly match the current set being reordered.
- **FR-008**: When a content item's update request (FR-006) changes its module membership to a
  different module within the same course, System MUST append it as that target module's last item —
  the same append-only rule as FR-001/FR-003; a follow-up FR-007 reorder call is required to place it
  anywhere else within the new module. System MUST reject a request to move a content item to a module
  belonging to a *different* course — module membership changes are scoped to modules within the
  content item's own course only.
- **FR-009**: System MUST allow users holding `course.manage` to delete a content item, and to delete a
  module (which also removes every content item that module holds).
- **FR-010**: System MUST scope every module, content item, and curriculum-read operation to the
  requesting user's own tenant, server-side, transitively through the owning course; requests
  targeting a course, module, or content item id outside the caller's tenant MUST be rejected as not
  found.
- **FR-011**: System MUST reject create, update, reorder, and delete requests from users who lack
  `course.manage`, and MUST reject all read operations (curriculum, module, content item) for users who
  hold neither `course.view` nor `course.manage` — reusing the existing course-level permissions, no
  new permission keys.
- **FR-012**: System MUST record `createdBy`/`createdAt` on creation and `updatedBy`/`updatedAt` on
  every subsequent change, for both modules and content items.
- **FR-013**: System MUST NOT provide native file upload for any content type in this feature — video,
  article, and external-import content are represented only via external URLs/embeds or inline text;
  native upload with object storage is explicitly deferred to a future spec.
- **FR-014**: System MUST NOT parse, host, or provide runtime playback/completion-tracking for imported
  packages (e.g. SCORM) in this feature — an `external_import` content item is a metadata pointer only;
  full import-runtime support is explicitly deferred to a future spec.
- **FR-015**: System MUST NOT include question-authoring, submission handling, grading, or attempt
  tracking for `test`/`assignment` content items in this feature — they are placeholder shells only.
- **FR-016**: System MUST NOT track learner-facing progress, completion, or scoring against any content
  item in this feature — this spec is authoring-only; that capability is explicitly deferred to a
  future spec.

### Key Entities *(include if feature involves data)*

- **Course Module**: A tenant-scoped, ordered section within exactly one course (spec 023's `courses`
  entity). Attributes: title, description (optional), a position determining its order among the
  course's other modules, and audit fields (created by, created at, updated by, updated at). Deleting a
  module removes every content item it holds (see Assumptions on this cascading behavior).
- **Content Item**: A tenant-scoped, ordered unit of curriculum content within exactly one module.
  Attributes: `type` (fixed enum: `video` / `article` / `live_class` / `test` / `assignment` /
  `external_import`, immutable once set), title, a position determining its order among the module's
  other content items, a common optional description/instructions field, a set of type-specific fields
  (a URL for `video`; inline body text and/or an external URL for `article`; scheduled date/time plus
  optional facilitator/meeting-link/capacity for `live_class`; an optional plain pass-criteria text
  field for `test`; an external URL plus a source-type label for `external_import`; nothing additional
  for `assignment` beyond title/description), and audit fields. Has no learner-facing progress/
  completion/score data in this spec — that relationship is added by a future spec, which will attach
  records to a content item by its id without requiring a change to this entity.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user holding `course.manage` can build a course's full curriculum (multiple modules,
  each with multiple content items of any type) using only single-item create calls, with no manual
  position bookkeeping required — every new module or content item is appended correctly by default.
- **SC-002**: A reorder operation is reflected in the very next curriculum read, with no intermediate
  inconsistent state observable.
- **SC-003**: 100% of attempts to read, create, update, reorder, or delete a module or content item
  belonging to a different tenant are rejected, verified by automated test.
- **SC-004**: 100% of module/content-item endpoint calls from users lacking the relevant permission
  (`course.view` for reads, `course.manage` for writes) are rejected, verified by automated test.
- **SC-005**: Retrieving a large course's full curriculum (20 modules, 10 content items each) returns
  with no perceptible delay to the caller.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: No change to the isolation model — modules and content items
  follow the existing shared-schema-with-`tenant_id`-scoping pattern already used by courses and every
  other tenant table; every row carries `tenant_id` and every query is scoped server-side (Principle
  I), even though both tables also reach their tenant transitively through the owning course/module.
- **Tenant-configurable vs. fixed platform-wide**: No new permission keys — this spec reuses
  `course.view`/`course.manage` exactly as already granted, per the explicit scoping decision. The
  content-item `type` enum (video/article/live_class/test/assignment/external_import) is fixed
  platform-wide, not tenant-configurable — these are structural content-kind definitions analogous to
  course delivery mode, not a tenant's own organizational taxonomy (same distinction spec 023 already
  drew for category vs. delivery mode).
- **AI-generation review/approval step**: N/A — this spec is manual authoring only; no AI-generated
  content is produced or ingested here.
- **Kirkpatrick L4/L5 data source & formula**: N/A — this spec touches no evaluation or ROI data.
- **Downgrade/cancellation behavior**: N/A — not a security, budget, or evaluation module.
- **Design system reference**: N/A — this spec ships no UI; it is API/data-model only, matching spec
  023's own scope pattern. A future UI spec will reference the established design system once one
  exists for the course catalog generally.
- **Demoable vs. internal**: Internal/infrastructure-only, same as spec 023 — demoable only via direct
  API calls until a follow-up UI spec exists.

## Assumptions

- Native file upload (for video, article attachments, or imported packages) is out of scope for this
  spec and is explicitly deferred as flagged future work — every content type that could reference
  media in this spec does so only via an external URL/embed or inline text, never an uploaded file.
- Full import-runtime support (SCORM/xAPI manifest parsing, content hosting, a runtime API bridge for
  progress/score reporting) is out of scope for this spec and is explicitly deferred as flagged future
  work — `external_import` is a metadata pointer (URL + source-type label) only.
- `test` and `assignment` content items are placeholder shells only in this spec — no question bank,
  question types, submission mechanism, grading engine, pass/fail evaluation, or attempt tracking exists
  yet; `test`'s pass-criteria field is a free-text note for humans, not an enforced rule.
- Learner-facing progress, completion, and scoring tracking is out of scope for this spec (authoring
  only) and is explicitly deferred as flagged future work.
- A content item's `type` is immutable once created — changing what kind of content an item represents
  requires deleting it and creating a new one, rather than an in-place type change (which would leave a
  now-invalid type-specific payload behind).
- Deleting a module cascades to delete every content item it holds, and deleting a content item is a
  hard delete (neither is a soft-delete/archive, unlike `courses` itself in spec 023). This is safe
  today because nothing in this spec's own scope creates a back-reference to a module or content item
  id. Flagged forward: a future Learning Progress spec, once it introduces completion/score records
  that reference a content item by id, MUST revisit this cascading hard-delete behavior (e.g. block
  deletion when progress records exist, or convert to archive-only) — not silently inherited as-is.
- Reordering is performed via a dedicated action accepting the complete ordered list of ids being
  reordered (all of a course's modules, or all of a module's content items) rather than by exposing raw
  position integers for arbitrary client-side editing — simpler to validate (a reorder is rejected
  outright if the submitted id set doesn't exactly match the current set) and avoids duplicate/gap
  position bugs.
- Permissions are reused directly from the course level (`course.view`/`course.manage`) with no new
  permission keys — a user who can manage a course can manage all of its modules and content items, and
  a user who can view a course can view its full curriculum.
- This is an API-only feature — no web UI ships as part of this spec, matching spec 023's own scope
  pattern; a future UI spec builds the authoring screens against this API.
