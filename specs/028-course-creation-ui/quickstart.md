# Quickstart: Course Creation UI

Validates this feature end-to-end in a real browser — there is no API to `curl` (spec is UI-only,
Clarifications), so every scenario here is a manual browser walkthrough. Assumes the local dev stack is
running (`pnpm dev`) and you're logged in as a tenant user holding `course.manage`.

## Prerequisites

1. `apps/web` dev server running, reachable at `http://localhost:3010` (or whichever port `pnpm dev`
   assigns).
2. A tenant session authenticated as a user holding `course.manage` (and, separately, a second session
   holding only `course.view` for Scenario 6).

## Scenario 1 — Set up a new course (User Story 1)

1. Navigate to `/learning/courses`.
2. Confirm 3 seeded sample courses are visible (research.md/contracts — mock seed data).
3. Click "Create a course," then "Create manually."
4. Confirm you land immediately on a new course's editor (Information tab), titled "Untitled course" with
   an "Uncategorized" category, self-paced delivery, and a 1-hour default duration — no setup form is
   shown first (Clarifications 2026-07-22).
5. On the Information tab's Course Details panel, edit the title, type a **new** category name (not one
   of the seeded ones), and change delivery mode/duration. Save.

**Expected**: The course updates in place (visible if you navigate back to `/learning/courses`); the new
category now appears in the category field's autocomplete for future courses; the Curriculum tab is
immediately available alongside Information, showing zero modules. Provider and cost are not present on
this panel — deferred to the future Pricing/Settings tabs (Clarifications 2026-07-22), not a bug.

## Scenario 2 — Build the curriculum (User Story 2)

1. From the course landed on in Scenario 1, add two modules.
2. Add one content item to each — pick a different type for each (e.g. `video` and `article`).
3. Drag one module above the other; drag a content item within one module to reorder it.

**Expected**: The outline reflects every change immediately, no page reload. Reordering persists as you
navigate between the Details and Curriculum tabs (still in the same session — a refresh would reset it,
per Clarifications).

## Scenario 3 — Simulated SCORM upload (User Story 2, Scenario 6)

1. Add a content item of type `external_import`.
2. Choose "Upload a SCORM package" (not the plain URL option).
3. Pick any file (its actual contents are irrelevant — the upload is simulated, research.md §6).

**Expected**: A progress indicator plays out, then the module shows one or more new content items
representing the mock SCO breakdown — never a real network request (check the browser's Network tab: no
request to `/tenant-api/.../scorm/...` should appear).

## Scenario 4 — Publish and unpublish (User Story 3)

1. On a draft course with at least one module/content item, use the publish control in the course
   header.
2. Unpublish it.

**Expected**: Status updates immediately in the header both times, visible from both the Details and
Curriculum tabs.

## Scenario 5 — AI-generation entry point (User Story 4)

1. From `/learning/courses`, click "Create a course."
2. Choose "Generate with AI" instead of "Create manually."

**Expected**: A clearly-labeled not-yet-available state appears — never a form, a blank screen, or
anything suggesting real generation ran.

## Scenario 6 — Permission gating (SC-004)

1. Log in as a user holding only `course.view` (not `course.manage`).
2. Navigate to `/learning/courses`.
3. Confirm no "Create a course" control is rendered anywhere on the page.
4. Open one of the seeded courses' editor pages directly by URL and confirm every field/action across all
   tabs is read-only (no save/publish/delete/add-module/add-content controls reachable).

**Expected**: Cannot create a course or make any edit; the create-course entry point isn't presented at
all rather than being reachable-then-blocked.

## Automated coverage

None — this spec has no backend to integration-test and this codebase has no frontend component-test
harness yet (plan.md Testing). Every scenario above must be manually walked through in a real browser
before this spec is considered done; `next build`/`tsc --noEmit` passing only confirms the code compiles,
not that the flow behaves correctly.
