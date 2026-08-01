# Research: Course Creation UI

## 1. New dependency: `@dnd-kit/core` + `@dnd-kit/sortable` (+ `@dnd-kit/utilities`)

**Decision**: Add these npm packages to `apps/web`. **Explicit sign-off obtained from the user during
`/speckit-plan`** (not assumed) per Constitution Principle XIII. `@dnd-kit/utilities` was added during
implementation (T021) as a small addendum, not a separate sign-off — it is `@dnd-kit/sortable`'s own
standard companion package (the `CSS.Transform.toString()` helper every `useSortable` consumer needs),
present transitively in the dependency tree already but not resolvable under pnpm's strict isolation
without also being a direct `apps/web` dependency; it adds no new capability beyond what was already
approved.

**Rationale**: Neither the browser nor React has a built-in accessible sortable-list primitive (the
native HTML5 Drag and Drop API exists but is notoriously poor for touch devices and accessibility
without a wrapper library). `@dnd-kit` is the current de facto standard for React drag-and-drop —
actively maintained, built-in keyboard support, and the direct successor to `react-beautiful-dnd`, which
Atlassian stopped maintaining in 2022 (a real long-term liability for new code).

**Alternatives considered**:
- `react-beautiful-dnd` — rejected: unmaintained, a known dead end for new development.
- Hand-rolled HTML5 Drag and Drop API — rejected: would require reimplementing keyboard accessibility
  and touch support from scratch, exactly the kind of complex, easy-to-get-wrong UI primitive a
  well-maintained library exists to solve correctly once.

## 2. No new `@tm/ui` exports — page-scoped components instead

**Decision**: New interactive primitives this spec needs (category autocomplete-with-create-option,
drag-and-drop outline, content-type picker) are built as local components inside
`apps/web/app/(dashboard-shell)/learning/courses/`, not added to the shared `@tm/ui` package.

**Rationale**: `@tm/ui` currently exports only Button/Input/Toggle/Card/Badge/PageHeader/Modal/
Pagination/Drawer/AppShell — none of these need adding to for this spec's own scope, and Constitution
Principle V's "no new visual identity or component library" is most safely honored by keeping
genuinely-new interaction patterns scoped to the one feature that needs them until a second consumer
emerges, rather than speculatively generalizing them into the shared package now.

**Alternatives considered**:
- Adding these to `@tm/ui` immediately — rejected as premature generalization; nothing else in this
  codebase needs a category-combobox or a drag-and-drop outline yet.

## 3. Mock data store: a plain module + `useSyncExternalStore`, no state-management dependency

**Decision**: `apps/web/lib/mock-course-data.ts` holds a plain in-memory array of courses (each with
nested modules/content items) plus a `Set` of subscriber callbacks, exposing `getCourses()`,
`createCourse()`, `updateCourse()`, `addModule()`, `reorderModules()`, `addContentItem()`,
`reorderContentItems()`, `deleteModule()`, `deleteContentItem()`, `setStatus()`, and a
`useMockCourses()` hook built on React's built-in `useSyncExternalStore`.

**Rationale**: The data needs to be shared and stay consistent across route navigations within one
browser tab (list → editor → back), which a per-component `useState` cannot do, but this codebase has no
existing state-management dependency (no Redux/Zustand/Jotai — confirmed via `apps/web/package.json`) and
Principle XII prefers a built-in solution first. `useSyncExternalStore` (React 18+, already available in
this app's React 19) is the exact built-in primitive for "subscribe a component to an external mutable
store," precisely this problem.

**Alternatives considered**:
- A new state-management library (Zustand, Jotai) — rejected: unnecessary new dependency for a problem
  React's own built-in hook already solves.
- React Context — considered and effectively equivalent for this scope, but `useSyncExternalStore` avoids
  needing a Provider wrapped around every route in the `courses/` tree, since the store is just an
  imported module, not something that needs to be threaded through the component tree.

## 4. Mock data shapes mirror the real API exactly

**Decision**: The mock `Course` type mirrors spec 023's real `courses` table columns
(`id`, `title`, `description`, `categoryId`/`categoryName`, `deliveryMode`
`in_person`/`virtual`/`self_paced`/`blended`, `durationValue`/`durationUnit`
`minutes`/`hours`/`days`, `provider`, `cost`, `status` `draft`/`active`/`archived`). The mock
`ContentItem` type mirrors spec 024's real `content_items` shape exactly, including each type's own
`payload` field requirements (`video`: `payload.url`; `article`: `payload.body` or
`payload.externalUrl`; `live_class`: `payload.scheduledAt`; `test`/`assignment`: no extra fields;
`external_import`: `payload.url` + `payload.sourceType`, or a mock SCORM package result shape mirroring
spec 027's real `scos` response array).

**Rationale**: Directly implements the spec's own stated goal (FR-003/FR-008/FR-009/FR-020) — a later
wiring spec should be able to swap the mock store's functions for real `fetch` calls against the already-
existing endpoints with no data-shape translation layer needed in between.

**Alternatives considered**: A simplified/ad hoc mock shape — rejected: would make the named follow-up
wiring spec harder, not easier, defeating the whole point of shaping the mock data this way now.

## 5. Route/navigation structure: linear wizard for new courses, tabbed editor for existing ones

**Decision**: Choosing "Create manually" goes to a dedicated setup-form route
(`courses/new/manual`); submitting it creates the mock course and navigates to
`courses/[courseId]` (defaulting to the Curriculum tab). That same `[courseId]` route — a tabbed editor
with "Details" (the same setup fields, now editable in place) and "Curriculum" tabs — is what's opened
when editing any existing mock course from the list (spec FR-014, "reuses this exact same flow").

**Rationale**: Matches Udemy's/TalentLMS's own observed pattern — a linear first-time setup step, then a
persistent tabbed editor thereafter — while still satisfying the spec's literal requirement that editing
reuse the same underlying setup+curriculum functionality (not a separate form/field set), just presented
as tabs instead of sequential steps once a course exists.

**Alternatives considered**:
- Forcing every edit back through the linear wizard from step one — rejected: bad UX precedent from
  neither reference product does this, and the spec's own Edge Cases assume an already-existing course
  can be opened directly into curriculum editing.

## 6. SCORM upload simulation

**Decision**: The external_import content-item form's "Upload a SCORM package" choice runs a local
`setTimeout`-driven fake progress sequence (no real file is read or transmitted), then produces a
hardcoded mock multi-SCO result shaped exactly like spec 027's real `POST .../scorm/import` response
(`{ packageId, scos: [{ contentItemId, title, position }] }`), and reflects those as new mock content
items in the outline — directly implementing spec FR-011/Clarifications.

**Rationale**: Keeps the simulation's output shape identical to the real endpoint's, so the named
follow-up wiring spec only needs to swap the fake-timer code for the real upload-url/import calls
already built in spec 027, changing nothing about how the UI consumes the result.

**Alternatives considered**: Skipping the SCORM sub-choice's visual detail entirely (just a disabled
placeholder) — rejected: spec FR-011 and US2/AS6 explicitly require the simulated progress-and-breakdown
experience, not a bare placeholder (that treatment is reserved for the AI-generation entry point only,
FR-002).

## 7. No new dependency for forms/validation

**Decision**: Plain controlled React components (`useState` per field) for every form in this spec,
matching `training-needs-client.tsx`'s own existing convention — no `react-hook-form`, no `zod`.

**Rationale**: This codebase has no existing form-library dependency (confirmed via
`apps/web/package.json`), and the forms in this spec are small enough (5-7 fields at most) that adding
one would be new-dependency overhead for a problem plain controlled inputs already solve adequately,
consistent with Principle XII.

**Alternatives considered**: `react-hook-form` + `zod` — rejected as unnecessary for this spec's scope;
revisit if a future, more complex form surface makes the case for it project-wide.
