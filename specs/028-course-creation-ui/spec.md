# Feature Specification: Course Creation UI

**Feature Branch**: `028-course-creation-ui`

**Created**: 2026-07-20

**Status**: Draft

**Input**: User description: "Course Creation UI — a guided, admin-facing authoring flow for creating and editing courses in the TM multi-tenant SaaS, covering both course setup (title, category, delivery mode, duration, provider, cost — spec 023's existing API) and curriculum building (modules and content items — spec 024's existing API) in one cohesive flow, modeled on Udemy's and TalentLMS's own course-creation UX: a persistent left-hand curriculum outline/stepper alongside the main editing panel, drag-and-drop reordering of modules and content items, inline "add content" affordances scoped to whichever module is being edited, and a course-level header showing status (draft/active/archived) with a publish/unpublish action (spec 023's existing status field — no new approval workflow). Entry point: an admin holding `course.manage` starts either "Create manually" or "Generate with AI" (the AI path is a UI entry point only in this spec — shows a clearly-labeled coming-soon/not-yet-available state rather than functioning generation, since real AI course generation is its own dedicated future spec requiring an LLM provider choice, prompt design, and the content-review step the constitution's AI-generation quality bar requires before AI-authored content can be published — this spec must not silently imply that capability already works). Course setup step: a form for title, category (reusing spec 023's category resolve-or-create-by-name behavior — typing a new category name creates it, matching an existing autocomplete-with-create-option pattern), delivery mode, duration (value + unit), provider, and cost, all validated against spec 023's existing API constraints. Curriculum step: add/rename/reorder/delete modules; within each module, add/reorder/delete content items of any of the 6 existing types (video, text, article, live_class, test, assignment, external_import) via a type picker, each rendering a simple form matching that type's existing payload shape from spec 024 (a URL field for video; a rich-ish text area for article, accepting either body text or an external URL per spec 024's own either/or rule; a scheduled-date field for live_class; no extra fields beyond title/description for the test/assignment placeholder-shells; for external_import, a sub-choice between a plain external URL/source-type import and a real SCORM 1.2 package upload — the latter wired to spec 027's actual working upload-url/import endpoints, presenting upload progress and the resulting SCO breakdown if the package contains multiple SCOs). No rich WYSIWYG editor, no real quiz-question-builder, and no video/file upload for the video content type itself (it stays URL-only, matching spec 024's own external-URL-only hosting decision for that type) — these are explicitly flagged as future polish, not silently implied as already complete, mirroring spec 024's own "placeholder-shell assessments" precedent. Editing an existing course reuses this exact same flow (no separate edit-only UI). Lives in `apps/web` under the existing `(dashboard-shell)` route group, following the established Server-Component-session/permission-check plus Client-Component-interactivity split already used by `training-requests` and the SCORM launcher page, and must visually reuse the already-established internal design system (Desktop Shell Visual Language, spec 008) and the existing `@tm/ui` component library — no new visual identity, no new component library, no design-system changes proposed by this spec. Gated entirely by the existing `course.manage`/`course.view` permissions from spec 023 — no new permission keys. Explicitly out of scope, to be documented as flagged future work: real AI course generation of any kind (outline or content); a rich text/WYSIWYG editor for article/text content; a real quiz/assessment question-builder; file/video upload for the video content type; any learner-facing course catalog, browse, or enrollment UI (that's a separate future spec — this one is authoring-only, matching spec 024's own "authoring-only scope" decision); bulk import/export of course structure; course versioning or templates."

## Clarifications

### Session 2026-07-20

- Q: Should this iteration connect to the real spec 023/024/027 backend APIs, or be UI-only? → A:
  UI-only — no real API calls anywhere in this spec. Deferred to a follow-up spec/phase that wires this
  exact UI to the already-existing backends.
- Q: Given UI-only, should the flow work against a small in-memory mock dataset or pure blank local
  state? → A: Seed a small in-memory mock dataset (a few sample courses) so "edit an existing course,"
  the curriculum outline, and reordering are all demoable — nothing persists across a page refresh.
- Q: Should the SCORM upload step (originally wired to spec 027's real, working endpoints) be an
  exception to the no-API rule? → A: No exception — mock/simulate it too (fake progress, fake SCO
  breakdown), for full consistency and a clean, well-defined follow-up scope.

### Session 2026-07-22

- Q: Mid-implementation, the flow evolved from a two-page setup-form-then-curriculum wizard into a
  single-editor shell (Information/Curriculum/Pricing/Performance/Settings tabs, matching Udemy/TalentLMS's
  own product layout more closely) where "Create manually" creates the course immediately with placeholder
  defaults and opens straight into the editor, rather than showing an upfront form first. Keep the original
  form-first flow, or adopt the evolved one? → A: Adopt the evolved instant-create-then-edit-in-place flow;
  this spec's User Story 1 and quickstart.md are updated to describe it as the actual, intended behavior.
- Q: A real `subcategory` column, migration, and API read/write support were added to the actual `courses`
  table/routes (spec 023's schema) alongside this iteration's work — a narrow, deliberate exception to "no
  apps/api changes." Keep it or split it out? → A: Keep it, as intentional forward-compatible groundwork for
  the future backend-wiring spec named in Assumptions. It remains disconnected from this spec's own UI-only
  mock state in this iteration — the mock UI's own `subcategory` field still only touches local/mock data,
  matching every other field (FR-020 still holds for the UI layer); only the real backend's schema/routes
  gained the column early.
- Q: A shared `RichTextEditor` primitive (built on Tiptap) was added to `@tm/ui` for the course description
  field, and the global `--color-surface` design token changed (a warmer off-white). Both are, strictly,
  design-system changes FR-016 originally ruled out. Keep them or revert? → A: Keep both as approved,
  intentional exceptions for this iteration — superseding the original "no new dependency without sign-off"
  assumption and FR-016's "no design-system changes" as originally scoped.
- Q: Provider and cost — both named in the original FR-003 setup-form field list — have no UI control
  anywhere in the evolved editor (Cost conceptually belongs in the not-yet-built Pricing tab; Provider has
  no other obvious home yet). Add them now, or defer? → A: Defer both explicitly as future work, tracked
  against the Pricing/Settings tabs already stubbed as "coming soon" in the editor shell — not silently
  dropped, and not built in this iteration.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Set up a new course (Priority: P1)

An L&D admin holding `course.manage` starts a new course and fills in its basic details — title,
category, delivery mode, duration, provider, and cost — through a guided form, without needing to know
any API details.

**Why this priority**: Nothing else in this flow is reachable without a course existing first — this is
the entry point the rest of the authoring experience builds on.

**Independent Test**: As a user holding `course.manage`, open "Create a course," choose "Create
manually," and confirm a new course is created immediately and the flow lands on that course's own
editor, ready to fill in its real details.

**Acceptance Scenarios**:

1. **Given** the course-creation entry screen, **When** an admin holding `course.manage` chooses "Create
   manually," **Then** a new course is created immediately in local/mock state with placeholder defaults
   (title "Untitled course," an "Uncategorized" category, self-paced delivery, a 1-hour default duration)
   and the admin lands on that course's own editor (Information tab), ready to fill in title, category,
   delivery mode, and duration in place.
2. **Given** the course editor's Information tab (Course Details panel), **When** the admin types a
   category name that doesn't yet exist and saves, **Then** the category is added to the mock dataset
   automatically (mirroring spec 023's resolve-or-create behavior for when this UI is later wired to the
   real API) and the course is updated against it in local state.
3. **Given** the course editor's Information tab, **When** the admin saves with a missing required field
   or an out-of-range value, **Then** the invalid field is clearly indicated and the change is not saved
   (the initial instant-create step itself always succeeds, since it uses valid placeholder defaults —
   validation is exercised on the edit that follows, not on creation itself).
4. **Given** a newly created course, **When** creation completes, **Then** the admin lands on that
   course's own editor page immediately (defaulting to the Information tab), with the Curriculum tab
   immediately available alongside it, showing zero modules.
5. **Given** a user holding only `course.view` (not `course.manage`), **When** they view the course list,
   **Then** no "Create a course" control is presented to them at all.

---

### User Story 2 - Build the curriculum (Priority: P1)

An admin adds modules and content items to a course, reorders them by dragging, and edits each content
item's own minimal fields, all from a persistent curriculum outline alongside the editing panel.

**Why this priority**: A course with no content is not a usable course — this is what actually makes the
flow deliver value, independently testable once User Story 1 provides a course to build on.

**Independent Test**: With a freshly created course, add two modules, add one content item to each
(choosing a different type each time), reorder both the modules and the content items by dragging, and
confirm the outline reflects every change immediately.

**Acceptance Scenarios**:

1. **Given** a course's curriculum step, **When** the admin adds a module, **Then** it appears in the
   left-hand outline immediately and becomes the active module for adding content.
2. **Given** a module, **When** the admin adds a content item and picks one of the 6 types (video,
   article, live_class, test, assignment, external_import), **Then** a form matching that type's own
   minimal field set appears, and saving it adds the item to that module in the outline.
3. **Given** two or more modules, **When** the admin drags one to a new position, **Then** the outline
   and the underlying order both reflect the new position immediately, with no page reload.
4. **Given** two or more content items within one module, **When** the admin drags one to a new position
   within that same module, **Then** the outline and underlying order reflect the new position
   immediately.
5. **Given** a module or content item, **When** the admin deletes it, **Then** it is removed from the
   outline and a confirmation is required first (an accidental single click cannot delete content).
6. **Given** an `external_import` content item, **When** the admin picks "Upload a SCORM package" instead
   of a plain external URL, **Then** a file picker for a `.zip` appears, a simulated upload progress is
   shown while a fake transfer plays out, and once the simulated import completes, fake resulting SCO(s)
   are reflected in the outline (a mock multi-SCO package shows as multiple content items, mirroring
   spec 027's own real import behavior for when this is later wired up).

---

### User Story 3 - Publish or unpublish a course (Priority: P1)

An admin changes a course's status between draft and active (and archives it when retired) from a
always-visible course-level control, without needing to leave the authoring flow.

**Why this priority**: A course stuck in draft forever is not a usable feature end-to-end — this closes
the loop and is the first point this flow is genuinely demoable to a stakeholder as a complete authoring
experience.

**Independent Test**: With a draft course that has at least one module and content item, publish it and
confirm its status updates immediately in the header; unpublish it and confirm the status reverts.

**Acceptance Scenarios**:

1. **Given** a draft course, **When** the admin uses the publish control, **Then** the course's status
   updates to active immediately, visible in the course header from anywhere in the flow.
2. **Given** an active course, **When** the admin unpublishes it, **Then** its status reverts to draft.
3. **Given** an archived course, **When** viewed, **Then** the status is clearly shown as archived and
   distinguished visually from draft/active.

---

### User Story 4 - See the AI-generation entry point (Priority: P3)

An admin sees "Generate with AI" as a clearly-presented alternative to manual creation on the entry
screen, understanding today that it isn't functional yet rather than being confused by a broken flow.

**Why this priority**: Lowest-complexity, most independent piece of this spec — establishes the entry
point the constitution's own named "AI Course Generation" feature will eventually attach to, without
building any of that feature's real capability now.

**Independent Test**: Open the course-creation entry screen and choose "Generate with AI"; confirm a
clearly-labeled coming-soon state appears instead of any functioning generation flow.

**Acceptance Scenarios**:

1. **Given** the course-creation entry screen, **When** an admin views it, **Then** both "Create
   manually" and "Generate with AI" are presented as distinct choices.
2. **Given** the entry screen, **When** the admin chooses "Generate with AI," **Then** a clearly-labeled
   not-yet-available state is shown — never a broken form, a silent no-op, or anything implying real
   generation is happening.

---

### Edge Cases

- What happens when two admins edit the same course's curriculum at the same time? Not applicable in
  this iteration — state is local to each browser tab/session (Clarifications), so there is no shared
  state for two admins to contend over; real concurrent-edit behavior is a question for the follow-up
  spec that wires this UI to the real, shared backend.
- What happens when the simulated SCORM upload (User Story 2, Scenario 6) is told to fail (a
  test/demo-only "simulate failure" trigger)? The failure is shown inline against that specific content
  item with a retry option; the course and its other content remain unaffected.
- What happens when an admin tries to publish a course with zero modules or zero content items? Allowed
  — this spec does not add a minimum-content gate; a content-completeness check before publish is
  flagged as possible future polish, not built here.
- What happens when an admin navigates away mid-edit with unsaved changes in a content-item form? A
  standard "unsaved changes" warning is shown before navigating away; individual field-level edits are
  not auto-saved as the admin types.
- What happens when the admin deletes a module that still has content items in it? The confirmation
  dialog (Acceptance Scenario 5) explicitly states that its content items will be deleted too, mirroring
  the cascade-delete behavior the real API (spec 024) already enforces, so the UI's own behavior won't
  need to change once wired up.
- What happens on a page refresh mid-flow? All in-progress and mock-created state is lost (Clarifications
  — nothing persists across a refresh in this iteration); this is an accepted, explicit limitation of the
  UI-only phase, not a bug to fix here.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a course-creation entry screen presenting "Create manually" and
  "Generate with AI" as distinct choices, gated by `course.manage`.
- **FR-002**: System MUST, when "Generate with AI" is chosen, present a clearly-labeled not-yet-available
  state rather than any functioning generation flow, form, or output.
- **FR-003**: System MUST, when "Create manually" is chosen, create the course immediately in local/mock
  state with valid placeholder defaults for title, category, delivery mode, and duration (value + unit)
  (Clarifications 2026-07-22), shaped to match spec 023's existing course-creation API so a later wiring
  pass is a drop-in swap, not a redesign; the admin then edits title, category, delivery mode, and
  duration in place from the course editor's Information tab (Course Details panel). Provider and cost
  are deferred (Clarifications 2026-07-22) — not part of this iteration's editable field set.
- **FR-004**: System MUST support typing a new category name in the Course Details panel and having it
  added to the mock dataset automatically on save, mirroring spec 023's resolve-or-create-by-name
  behavior, without a separate category-management step.
- **FR-004a**: System MUST provide a Subcategory field on the Course Details panel, operating on
  local/mock state only in this iteration (FR-020 still applies at the UI layer) — even though, as a
  deliberate, narrow exception to FR-020/"no apps/api changes" (Clarifications 2026-07-22), the real
  `courses` table and its API routes also gained a matching `subcategory` column as forward-compatible
  groundwork for the future backend-wiring spec (Assumptions); this UI does not call that real endpoint
  yet.
- **FR-005**: System MUST perform the same field-level validation the real API would (missing/invalid
  fields) client-side against the mock data, surfacing errors inline on the Course Details panel, without
  saving the change when validation fails. This iteration's instant-create step itself always succeeds
  (valid placeholder defaults, Clarifications 2026-07-22); validation is exercised on subsequent edits.
- **FR-006**: System MUST land the admin on that course's own editor page (defaulting to the Information
  tab) immediately after a course is created in local/mock state, with the Curriculum tab immediately
  reachable alongside it, scoped to that course.
- **FR-007**: System MUST present a persistent curriculum outline (modules and their content items)
  alongside the active editing panel throughout the curriculum-building step.
- **FR-008**: System MUST allow adding, renaming, reordering (via drag-and-drop), and deleting modules,
  reflecting every change in the outline immediately without a page reload, against local/mock state
  shaped to match spec 024's existing module API (Clarifications — no real API call in this iteration).
- **FR-009**: System MUST allow adding, reordering (via drag-and-drop, within the same module), and
  deleting content items within a module, via a type picker covering all 6 existing content-item types
  (video, article, live_class, test, assignment, external_import), against local/mock state shaped
  to match spec 024's existing content-item API.
- **FR-010**: System MUST render a distinct, minimal form per content-item type matching that type's own
  existing payload shape (spec 024) — a URL field for video; a text-or-external-URL choice for article;
  a scheduled-date field for live_class; title/description only for test/assignment; a source-type
  choice (external URL vs. SCORM package upload) for external_import — with no rich-text editor or
  quiz-question-builder in any of them.
- **FR-011**: System MUST, for an external_import content item where "Upload a SCORM package" is chosen,
  simulate the upload-and-import flow (Clarifications — mocked in this iteration, not a real call to
  spec 027's working endpoints) — showing a simulated progress indicator, and reflecting every resulting
  mock SCO as its own content item in the outline once the simulated import completes.
- **FR-012**: System MUST require an explicit confirmation before deleting a module or content item, and
  MUST state in that confirmation when deleting a module will also delete its content items.
- **FR-013**: System MUST display a course's current status (draft/active/archived) in a persistently
  visible course-level header throughout the flow, and MUST provide publish (draft→active) and unpublish
  (active→draft) actions there, updating local/mock state shaped to match spec 023's existing
  status-transition API.
- **FR-014**: System MUST allow opening this exact same flow (setup + curriculum) against an existing
  mock course to edit it, pre-filled with that course's current mock data — no separate edit-only screen
  or form set.
- **FR-015**: System MUST gate every screen and action in this flow by the existing `course.manage`
  (write actions) or `course.view` (read-only access, where applicable) permissions — no new permission
  keys are introduced.
- **FR-016**: System MUST visually conform to the established internal design system (Desktop Shell
  Visual Language, spec 008) and the existing shared component library, with two approved, deliberate
  exceptions carved out in this iteration (Clarifications 2026-07-22): a new shared `RichTextEditor`
  primitive (built on Tiptap) added to `@tm/ui` for the course description field, and a global
  `--color-surface` design-token refresh (a warmer off-white). No other new visual identity, component
  library, or design-system change is introduced by this spec.
- **FR-017**: System MUST NOT perform any real AI-driven course generation (outline or content) in this
  feature — explicitly deferred future work (FR-002).
- **FR-018**: System MUST NOT provide a rich WYSIWYG editor, a real quiz/assessment question-builder, or
  file/video upload for the video content type in this feature — explicitly deferred future work.
- **FR-019**: System MUST NOT provide any learner-facing course catalog, browse, or enrollment UI, and
  MUST NOT provide bulk import/export or course versioning/templates in this feature — explicitly
  deferred future work.
- **FR-020**: System MUST NOT make any real network call to spec 023/024/025/027's backend APIs anywhere
  in this feature (Clarifications) — every create/update/delete/upload action operates on local/mock
  state only, shaped to match those APIs' existing shapes so a later wiring pass is additive, not a
  redesign.
- **FR-021**: System MUST seed a small set of sample courses into local/mock state on load, with
  realistic titles/categories/modules/content items, so User Story 1's "edit an existing course" path and
  the curriculum outline are demoable without any real backend (Clarifications).

### Key Entities *(include if feature involves data)*

- No new backend data entities, with one narrow, deliberate exception (Clarifications 2026-07-22): a real
  `subcategory` text column and matching read/write API support were added to spec 023's actual `courses`
  table/routes as forward-compatible groundwork for the future backend-wiring spec (Assumptions) — this
  UI does not call that endpoint. Otherwise, this spec's local/mock state is shaped to match the
  already-existing `Course`, `Course Category`, `Course Module`, and `Content Item` entities (spec
  023/024) and the already-existing `SCORM Package` upload/import result shape (spec 025/027), but — per
  Clarifications — none of it is persisted through those real APIs in this iteration; it lives only in
  the browser session's local/mock state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin can go from the course-creation entry screen to a published course with at least
  one module and one content item in under 5 minutes on first attempt, without consulting outside
  documentation.
- **SC-002**: 100% of drag-and-drop reorder actions (modules and content items) are reflected in the
  visible outline immediately, with no page reload, verified by manual testing across every content type
  (state lives only in the local/mock session for this iteration, per Clarifications).
- **SC-003**: 100% of "Generate with AI" selections show the not-yet-available state — 0% ever reach a
  functioning generation output or a broken/blank screen.
- **SC-004**: 100% of course-creation and curriculum-editing actions attempted by a user lacking
  `course.manage` are blocked before any local/mock state change occurs.
- **SC-005**: A simulated SCORM package upload's progress and resulting mock SCO breakdown are visible to
  the admin within the same screen, with no separate page navigation required to see the result.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: Largely N/A for this iteration — this UI makes zero real network
  calls (Clarifications) and tenant isolation is a property of the real backend it will eventually be
  wired to. The one exception (Clarifications 2026-07-22): the real `courses` table's new `subcategory`
  column and its API routes inherit that table's existing tenant-scoped, RLS-enforced access pattern
  unchanged — it is an additive column on an already tenant-isolated table, not a new isolation boundary.
  The follow-up spec that wires this UI to the real backend inherits spec 023/024/027's endpoints,
  including this column, unchanged.
- **Tenant-configurable vs. fixed platform-wide**: No new permission keys; reuses `course.manage`/
  `course.view`. The 6 content-item types and their minimal per-type forms are fixed platform-wide, not
  tenant-configurable, matching spec 024's own precedent.
- **AI-generation review/approval step**: N/A for what this spec actually builds (the AI path is a
  non-functional entry point only, FR-002) — flagged explicitly so a future AI-generation spec knows this
  spec deliberately did not design that review/approval gate; it must not be assumed to already exist.
- **Kirkpatrick L4/L5 data source & formula**: N/A — this spec touches no evaluation or ROI data.
- **Downgrade/cancellation behavior**: N/A — this spec introduces no plan-tier-gated capability of its
  own; the constitution's own "AI Course Generation" plan-tier gate applies to the future spec that
  builds real generation, not to this spec's placeholder entry point.
- **Design system reference**: Reuses the established Desktop Shell Visual Language (spec 008) and the
  existing `@tm/ui` component library throughout — no new visual identity or component library proposed
  (FR-016).
- **Demoable vs. internal**: Demoable — the first genuinely complete admin-facing authoring *experience*
  in this course/content spec sequence (023-024 were API-only; 027 built a learner-facing player, not an
  authoring UI), though — per Clarifications — this iteration is a UI-only mock, not backed by real,
  persisted data; that distinction must be communicated honestly when this is demoed, not glossed over.

## Assumptions

- This spec is authoring-only, matching spec 024's own established scope boundary — no learner-facing
  browse/catalog/enrollment UI exists yet; a course created here becomes reachable to learners only
  through whatever future spec builds that surface (and, per Clarifications, only once a future spec also
  wires this UI to the real backend at all).
- "Editing an existing course" (FR-014) is not a separately specced flow — it is the exact same
  setup+curriculum flow, pre-filled, per the input's own explicit decision. Any UI differences between
  first-time creation and later editing (e.g., not re-showing the AI-vs-manual entry choice when editing)
  are a reasonable, expected consequence of pre-filling, not a separate requirement.
- No minimum-content-before-publish gate is enforced (Edge Cases) — a course can be published with zero
  curriculum content; tightening this is flagged as possible future polish, not assumed needed.
- Drag-and-drop reordering updates local/mock state shaped to match spec 023/024's existing reorder
  endpoints (courses' own module reorder, content-item reorder) — per Clarifications, no real API call is
  made in this iteration; a later wiring pass swaps the mock state update for the real endpoint call.
- Drag-and-drop uses `@dnd-kit/core`/`@dnd-kit/sortable`, approved during `/speckit-plan` (plan.md
  Technical Context). Mid-implementation, a second dependency — Tiptap, for the shared `RichTextEditor`
  primitive in `@tm/ui` — was also added and approved (Clarifications 2026-07-22), superseding this
  assumption's original "no new dependency" framing; both are the only new dependencies introduced by
  this spec.
- Provider and cost, both named in this spec's original field list, are deferred as future work
  (Clarifications 2026-07-22) — tracked against the editor's already-stubbed "coming soon" Pricing/Settings
  tabs rather than built in this iteration.
- **A follow-up spec/phase is required to wire this UI to the real spec 023/024/025/027 backends**
  (Clarifications) — named explicitly here so it is not silently forgotten, matching this session's own
  established pattern of naming required follow-up work rather than letting a scope-narrowing decision
  disappear once the spec ships.
