---

description: "Task list template for feature implementation"
---

# Tasks: Course Creation UI

**Input**: Design documents from `/specs/028-course-creation-ui/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/mock-course-data-service.md, quickstart.md — all present.

**Tests**: None generated — this spec has no backend to integration-test (UI-only, spec Clarifications)
and this codebase has no established frontend component-test harness to extend (plan.md Testing).
Manual browser verification against quickstart.md substitutes for automated tests, called out explicitly
in Phase 7 rather than silently skipped.

**Organization**: Tasks are grouped by user story (spec.md: US1 = P1 "Set up a new course", US2 = P1
"Build the curriculum", US3 = P1 "Publish or unpublish a course", US4 = P3 "See the AI-generation entry
point").

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US4)
- File paths are exact, from plan.md's Project Structure

## Path Conventions

Existing pnpm/Turborepo monorepo — no new top-level project. **This spec touches only `apps/web`** — no
`apps/api` changes (UI-only, spec Clarifications).

---

## Phase 1: Setup

- [x] T001 Feature branch `028-course-creation-ui` checked out from a clean `master` (Constitution Principle X, after spec 027 was fast-forward-merged in) — already done this session.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The drag-and-drop dependency and the mock data store — every user story depends on both
existing first.

**⚠️ CRITICAL**: No user story task may begin until this phase is complete.

- [x] T002 [P] Install `@dnd-kit/core` and `@dnd-kit/sortable` in `apps/web` (`pnpm --filter web add @dnd-kit/core @dnd-kit/sortable`) — dependency already explicitly approved during `/speckit-plan` (plan.md Technical Context)
- [x] T003 Implement `apps/web/lib/mock-course-data.ts` — types (`MockCourse`, `MockCourseCategory`, `MockCourseModule`, `MockContentItem`, `ContentItemPayload` per data-model.md, mirroring spec 023/024's real column/CHECK shapes exactly), seed data (3 sample courses spanning draft/active status and varied content types, contracts §Seed data), and the course/category functions: `getCourses`, `getCourse`, `createCourse` (with case-insensitive resolve-or-create category logic, research.md §4), `updateCourseDetails`, `setCourseStatus`, `getCategories` — every write function returns `{ error: string }` on validation failure rather than throwing (contracts §Validation errors)
- [x] T004 Extend `apps/web/lib/mock-course-data.ts` (same file, depends on T003) — module functions (`addModule`, `renameModule`, `reorderModules` with exact-permutation validation, `deleteModule` with cascade-delete of its content items) and content-item functions (`addContentItem` with per-type payload validation mirroring `content-item-payload-validation.ts` exactly, `updateContentItem`, `reorderContentItems`, `deleteContentItem`, `simulateScormUpload` returning a `Promise` with a fake progress sequence and a mock multi-SCO result shaped like spec 027's real response, research.md §6) plus the `useMockCourses`/`useMockCourse` React hooks built on `useSyncExternalStore` (research.md §3) (depends on T003)

**Checkpoint**: The mock data store and drag-and-drop dependency both exist. User story implementation
can begin.

---

## Phase 3: User Story 1 - Set up a new course (Priority: P1) 🎯 MVP

**Goal**: An admin holding `course.manage` can see the seeded course list, start "Create manually," fill
in the setup form (including creating a new category inline), and land on the new course's page.

**Independent Test**: As a user holding `course.manage`, open the course list, click "Create a course" →
"Create manually," submit the setup form with a brand-new category name, and confirm the flow lands on
the new course.

### Implementation for User Story 1

- [x] T005 [US1] Implement `apps/web/app/(dashboard-shell)/learning/courses/page.tsx` (Server Component) — mirrors `training-requests/page.tsx`'s exact session/permission-check pattern: `getTenantSession`, requires `course.view` or `course.manage`, redirects to `/dashboard` if neither, renders `courses-list-client.tsx` (depends on T004)
- [x] T006 [P] [US1] Implement `apps/web/app/(dashboard-shell)/learning/courses/courses-list-client.tsx` (Client Component) — `useMockCourses()` to list every seeded/created course (title, category name, status badge, module/content-item counts), a "Create a course" button linking to `/learning/courses/new`, each row linking to `/learning/courses/[courseId]` (depends on T004)
- [x] T007 [US1] Implement `apps/web/app/(dashboard-shell)/learning/courses/category-combobox.tsx` (Client Component; moved from the `[courseId]/`-scoped path plan.md originally listed, so both `new/manual/` and `[courseId]/` can import it without crossing the dynamic route segment) — autocomplete-with-create-option over `getCategories()`: typing a name filters existing categories, and an unmatched name shows a "Create '{name}'" option (spec FR-004, research.md §4); reusable by both the setup form (this story) and the Details tab (US2) (depends on T004)
- [x] T008 [US1] Implement `apps/web/app/(dashboard-shell)/learning/courses/new/page.tsx` (Server Component) — session/permission check (`course.manage` required to create), renders `entry-client.tsx` (depends on T004)
- [x] T009 [US1] Implement `apps/web/app/(dashboard-shell)/learning/courses/new/entry-client.tsx` (Client Component) — presents "Create manually" as a choice linking to `/learning/courses/new/manual` (spec FR-001); the "Generate with AI" choice is added later by US4 (T023) — this task builds the manual path only, matching each story's own independent scope
- [x] T010 [US1] Implement `apps/web/app/(dashboard-shell)/learning/courses/new/manual/page.tsx` (Server Component) — session/permission check (`course.manage`), renders `setup-form-client.tsx` (depends on T004)
- [x] T011 [US1] Implement `apps/web/app/(dashboard-shell)/learning/courses/new/manual/setup-form-client.tsx` (Client Component) — controlled form for title, category (via `category-combobox.tsx`, T007), delivery mode, duration (value + unit), provider, cost; on submit calls `createCourse()` (T003), surfaces its `{ error }` result inline per-field without navigating away on failure (spec FR-003/FR-005), and on success `router.push`es to `/learning/courses/{course.id}` (spec FR-006) (depends on T003, T007)

**Checkpoint**: User Story 1 is fully functional and independently testable — a course can be set up and
its category created inline.

---

## Phase 4: User Story 2 - Build the curriculum (Priority: P1)

**Goal**: From a course's page, an admin adds/renames/reorders/deletes modules and content items of any
of the 6 types (including a simulated SCORM upload), with the outline updating immediately.

**Independent Test**: On a freshly created or seeded course, add two modules, add one content item of a
different type to each, drag-reorder both modules and content items, and confirm the outline reflects
every change immediately.

### Implementation for User Story 2

- [x] T012 [US2] Implement `apps/web/app/(dashboard-shell)/learning/courses/[courseId]/page.tsx` (Server Component) — mirrors `training-requests/[id]/page.tsx`'s exact pattern: session/permission check (`course.view` or `course.manage`), passes `courseId` as a prop to `course-editor-client.tsx` (the mock store itself is client-only, research.md §3, so this Server Component does no data fetching of its own) (depends on T004)
- [x] T013 [US2] Implement `apps/web/app/(dashboard-shell)/learning/courses/[courseId]/course-editor-client.tsx` (Client Component) — `useMockCourse(courseId)`; renders a persistent header (title, status badge — the publish/unpublish action itself is added by US3, T022) and a Details/Curriculum tab switcher, defaulting to the Curriculum tab (spec FR-006/research.md §5); a 404-style "not found" state if `courseId` doesn't resolve in the mock store (depends on T004)
- [x] T014 [US2] Implement `apps/web/app/(dashboard-shell)/learning/courses/[courseId]/details-tab.tsx` (Client Component) — the same field set as `setup-form-client.tsx` (T011), pre-filled and editable in place, reusing `../category-combobox.tsx` (T007), calling `updateCourseDetails()` (spec FR-014 — "reuses this exact same flow") (depends on T004, T007)
- [x] T015 [US2] Implement `apps/web/app/(dashboard-shell)/learning/courses/[courseId]/content-item-type-picker.tsx` (Client Component) — presents all 6 content-item types (video, article, live_class, test, assignment, external_import) as a picker, rendering the matching form component once one is chosen (depends on T004)
- [x] T016 [P] [US2] Implement `apps/web/app/(dashboard-shell)/learning/courses/[courseId]/content-item-forms/video-form.tsx` — a single required URL field, matching `content-item-payload-validation.ts`'s `video` shape (data-model.md) (depends on T004)
- [x] T017 [P] [US2] Implement `apps/web/app/(dashboard-shell)/learning/courses/[courseId]/content-item-forms/article-form.tsx` — a free-text-or-external-URL choice (at least one required), matching the `article` payload shape (depends on T004)
- [x] T018 [P] [US2] Implement `apps/web/app/(dashboard-shell)/learning/courses/[courseId]/content-item-forms/live-class-form.tsx` — a required scheduled-date field, matching the `live_class` payload shape (depends on T004)
- [x] T019 [P] [US2] Implement `apps/web/app/(dashboard-shell)/learning/courses/[courseId]/content-item-forms/test-assignment-form.tsx` — title/description only, shared shell for both `test` and `assignment` (no extra payload fields, matching the placeholder-shell payload shape) (depends on T004)
- [x] T020 [US2] Implement `apps/web/app/(dashboard-shell)/learning/courses/[courseId]/content-item-forms/external-import-form.tsx` — a sub-choice between a plain external URL (`url` + `sourceType` fields) and "Upload a SCORM package" (a file picker triggering `simulateScormUpload()`, T004, showing its fake progress and, on completion, the resulting mock SCO breakdown — spec FR-011/US2 AS6) (depends on T004)
- [x] T021 [US2] Implement `apps/web/app/(dashboard-shell)/learning/courses/[courseId]/curriculum-tab.tsx` (Client Component) — the persistent outline (modules → their content items) wrapped in `@dnd-kit`'s `DndContext`/`SortableContext` for both module-level and (within-module) content-item-level drag-and-drop reordering (calling `reorderModules`/`reorderContentItems`, T004); add/rename module controls; the "add content item" affordance scoped to whichever module is active, wiring in `content-item-type-picker.tsx` (T015) and its 5 form components (T016-T020); an explicit confirmation dialog before deleting a module (stating its content items will be deleted too) or a content item (spec FR-012) (depends on T002, T004, T014, T015, T016, T017, T018, T019, T020)

**Checkpoint**: User Stories 1 AND 2 both work independently — a course can be set up and its curriculum
fully built out, including a simulated SCORM upload.

---

## Phase 5: User Story 3 - Publish or unpublish a course (Priority: P1)

**Goal**: The course header's publish/unpublish control changes a course's status immediately, visible
from both tabs.

**Independent Test**: On a draft course, publish it and confirm the header updates immediately; unpublish
it and confirm it reverts.

### Implementation for User Story 3

- [x] T022 [US3] Extend `apps/web/app/(dashboard-shell)/learning/courses/[courseId]/course-editor-client.tsx` (T013's file) — add the publish (draft→active) / unpublish (active→draft) control to the persistent header, calling `setCourseStatus()` (T003); distinct visual treatment for `archived` status (spec US3 AS3) (depends on T013)

**Checkpoint**: User Stories 1, 2, AND 3 all work independently — the full authoring-to-publish loop
works end-to-end against the mock store.

---

## Phase 6: User Story 4 - See the AI-generation entry point (Priority: P3)

**Goal**: The entry screen also offers "Generate with AI," which shows a clearly-labeled not-yet-available
state rather than any functioning flow.

**Independent Test**: Open the entry screen, choose "Generate with AI," and confirm a clearly-labeled
coming-soon state appears — never a broken form or silent no-op.

### Implementation for User Story 4

- [x] T023 [US4] Extend `apps/web/app/(dashboard-shell)/learning/courses/new/entry-client.tsx` (T009's file) — add "Generate with AI" as a second, equally-presented choice alongside "Create manually," which shows a clearly-labeled not-yet-available state in place (spec FR-002) rather than navigating anywhere or submitting anything (depends on T009)

**Checkpoint**: All four user stories are independently functional — the full spec scope is complete.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Verification work that spans or sits outside individual user stories.

- [x] T024 [P] Run `pnpm --filter web build` (and `tsc --noEmit`) to confirm the feature compiles cleanly, then manually walk through all 6 of quickstart.md's scenarios in a real browser (list/seed data, setup + inline category creation, curriculum building + drag-and-drop, simulated SCORM upload, publish/unpublish, AI entry-point placeholder, permission gating) — this spec has no automated test coverage (plan.md Testing), so this manual walkthrough is the one verification step standing in for it, called out explicitly rather than silently skipped, matching the same pattern already established for spec 027's launcher page (depends on T011, T021, T022, T023). **Completed 2026-07-22** against a real tenant/user set up for this session (`pnpm --filter web build` clean; all 6 scenarios manually verified in Chrome). Two real bugs were found and fixed during this pass:
  - Module rename (`curriculum-tab.tsx`): dnd-kit's drag `listeners` (which include its keyboard sensor's Space-to-pick-up binding) were spread onto the div wrapping the rename `<input>`, so typing a space while renaming a module got intercepted for drag instead of typed — fixed by excluding `listeners`/`attributes` while `editingTitle` is true.
  - Module/content-item reorder didn't survive a tab switch (`mock-course-data.ts`'s `useMockModules`/`useMockContentItems`): both hooks filtered the flat store arrays by parent id but never sorted by the course's `moduleIds`/module's `contentItemIds` — the exact field `reorderModules`/`reorderContentItems` write to — so a drag-and-drop reorder visually worked in the moment but reverted on remount. Fixed by deriving order from those id arrays.
  - Also discovered and fixed a pre-existing, unrelated gap: the dashboard sidebar's "Courses" nav entry (`apps/web/app/(dashboard-shell)/layout.tsx`, predating this spec) was still a permanently-disabled "Soon" placeholder — this entire feature had no way to be reached from navigation. Now gated by `course.view`/`course.manage` and pointed at `/learning/courses`, folded into the "Learning" section alongside Training Requests.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — already complete (T001).
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories.
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion.
  - US1 (Phase 3) has no dependency on any other story.
  - US2 (Phase 4) depends on Foundational (T004) for its own components, and on US1's `category-combobox.tsx`
    (T007) for its own Details tab (T014) — otherwise independent of US1's other components.
  - US3 (Phase 5) depends on US2's `course-editor-client.tsx` (T013) — it extends that same file.
  - US4 (Phase 6) depends on US1's `entry-client.tsx` (T009) — it extends that same file.
- **Polish (Phase 7)**: Depends on all four user stories being complete.

### Within Each User Story

- Server Components (session/permission checks) before the Client Components they render.
- Shared components (`category-combobox.tsx`, the 5 content-item forms, the type picker) before the
  components that assemble them (`curriculum-tab.tsx`, the setup/details forms).
- Story complete before moving to the next priority (or in parallel, per staffing).

### Parallel Opportunities

- T002 (dependency install) is independent of T003/T004 (mock data store) — both can proceed in parallel
  once Foundational phase starts.
- T006 (list client) can be built in parallel with T007 (category combobox) once T004 lands — both only
  depend on the store, not on each other.
- T016-T019 (the four simplest content-item forms) are fully independent of each other — all can be built
  in parallel once T004 lands; T020 (SCORM form) is slightly more involved but still independent of the
  other four.
- T024 (polish/manual verification) is the only `[P]`-marked task outside Foundational, since it's the
  final cross-cutting step with no sibling task to parallelize against — the marker reflects that it has
  no blocking effect on anything else, not that it runs alongside another task.

---

## Parallel Example: Foundational Phase

```bash
# Once Setup is done, these can proceed in parallel:
Task: "Install @dnd-kit/core and @dnd-kit/sortable"
Task: "Implement mock-course-data.ts course/category functions and seed data"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (already done).
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: Manually confirm the course list, entry screen, and setup form all work,
   including inline category creation.
5. A course with no curriculum is not yet a usable authoring flow — User Story 2 (curriculum builder) is
   the natural next increment, and the first point this spec is genuinely demoable end-to-end.

### Incremental Delivery

1. Complete Setup + Foundational → mock store and drag-and-drop dependency ready.
2. Add User Story 1 → manually verify (course list, setup form, inline category creation).
3. Add User Story 2 → manually verify (curriculum building, drag-and-drop, all 6 content types, simulated
   SCORM upload) → this is the first point the flow is genuinely demoable as a complete authoring
   experience.
4. Add User Story 3 → manually verify (publish/unpublish).
5. Add User Story 4 → manually verify (AI entry-point placeholder).
6. Phase 7 polish → full spec scope walked through manually per quickstart.md; `next build` confirms
   everything compiles.

### Parallel Team Strategy

With multiple developers: all complete Setup + Foundational together (the mock store is the one shared
dependency everything else needs). Once Foundational lands, US1's route work and US2's shared components
(the 4 simple content-item forms, T016-T019) can proceed in parallel — US2's `curriculum-tab.tsx` (T021)
is the natural integration point where all of US2's pieces come together, so it's best done last within
that story.

---

## Implementation Note (2026-07-22, post-hoc)

The route/file plan below (T005-T023) describes the *original* design. During implementation this pivoted
to a more evolved editor-shell design (Clarifications, spec.md, 2026-07-22 session) — a single course
editor with Information/Curriculum/Pricing/Performance/Settings tabs, where "Create manually" creates the
course instantly (placeholder defaults) and opens straight into the editor, rather than a separate
`/new` → `/new/manual` setup-form wizard. All 23 tasks' *functional intent* was still delivered; only the
concrete file layout changed. Mapping from planned to actual, for anyone tracing a task to its code:

| Planned (tasks.md, T005-T023) | Actual |
|---|---|
| `new/page.tsx`, `new/entry-client.tsx` (T008, T009) | `create-course-menu.tsx` (a popover on the list page, not a separate route) |
| `new/manual/page.tsx`, `new/manual/setup-form-client.tsx` (T010, T011) | Folded into instant-create (`create-course-menu.tsx`) + `[courseId]/course-details-panel.tsx` (edit-in-place) |
| `[courseId]/details-tab.tsx` (T014) | `[courseId]/information-tab.tsx`, composing `course-details-panel.tsx`, `course-objectives-panel.tsx`, `course-authors-panel.tsx`, `add-author-drawer.tsx` (richer than originally planned; objectives/authors are out-of-spec scope additions, fully wired, not dead code) |
| `[courseId]/curriculum-tab.tsx` (T021) | Split into `[courseId]/curriculum-shell.tsx` (shell) + `[courseId]/curriculum-tab.tsx` (outline/dnd) |
| US4's AI entry point (T023, extends `entry-client.tsx`) | A "Coming soon" modal launched from `create-course-menu.tsx`'s "Generate with AI" item |

T024 (build + manual walkthrough) still applies as written in intent; walk through quickstart.md's actual
current scenario steps (updated 2026-07-22), not the file paths named in T005-T023 above.

## Notes

- `[P]` tasks = different files, or same file with non-overlapping handlers and no completion-order
  dependency.
- `[Story]` label maps task to specific user story for traceability.
- Every user story is independently manually verifiable per its own Independent Test description.
- Commit after each task or logical group.
- Stop at any checkpoint to validate a story independently before continuing.
- This spec makes zero real network calls anywhere (spec FR-020) — if any task's implementation is
  tempted to reach for `fetch`, that's a signal the task description was misread; everything routes
  through `mock-course-data.ts` (T003/T004) only.
