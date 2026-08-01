# Implementation Plan: Course Creation UI

**Branch**: `028-course-creation-ui` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/028-course-creation-ui/spec.md`

## Summary

Build the admin-facing course-authoring flow in `apps/web` entirely against **local, in-memory mock
data** — per spec Clarifications, zero real calls to spec 023/024/025/027's backend APIs in this
iteration. A course-creation entry screen (manual vs. AI-placeholder), a setup form, and a tabbed course
editor (Details + Curriculum, the latter with drag-and-drop-reorderable modules/content items covering
all 6 existing content-item types, including a simulated SCORM upload) all read/write a small
session-scoped mock store, seeded with sample courses on load. Reuses the established design system
(`@tm/ui`, Desktop Shell Visual Language) and the existing plain-React-forms/no-form-library convention
already used by `training-requests`. One new dependency — `@dnd-kit/core` + `@dnd-kit/sortable` — for
drag-and-drop reordering. A follow-up spec wires this exact UI to the real backends.

## Technical Context

**Language/Version**: TypeScript 5.x / React 19 / Next.js 15 (`apps/web`) — matching every existing
module in the app.

**Primary Dependencies**: Next.js App Router, `@tm/ui` (Button, Input, Card, Badge, PageHeader, Modal,
Drawer), `getTenantSession` + the existing `(dashboard-shell)` layout's session/permission-check pattern
— all already in place. Plain controlled-component forms (no form library), matching
`training-needs-client.tsx`'s own established convention.

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: `@dnd-kit/core` +
`@dnd-kit/sortable` — drag-and-drop sortable-list reordering (modules, content items within a module)
has no built-in browser/React primitive; `@dnd-kit` is the actively-maintained modern standard (the
direct successor to the now-unmaintained `react-beautiful-dnd`), with built-in keyboard-accessible
reordering (research.md §1). **Explicit sign-off was obtained from the user during this planning
session** — approved, not assumed.

**Storage**: None (new) — per spec Clarifications, this iteration has zero backend persistence. A
session-scoped, in-memory mock store (plain TypeScript module + React's built-in
`useSyncExternalStore`, no new state-management dependency) holds all course/module/content-item data
for the lifetime of the browser tab; nothing survives a page refresh (spec Edge Cases).

**Testing**: None new required beyond this codebase's existing `next build`/`tsc --noEmit` verification
gates — this spec has no backend routes to integration-test (spec is UI-only), and this codebase has no
established frontend component-test harness yet to extend. Manual browser verification substitutes for
automated UI tests, same as flagged for spec 027's launcher page.

**Target Platform**: Web browser via the existing `apps/web` Next.js deployment — no platform change.

**Project Type**: Web application (existing Next.js + Fastify monorepo). This spec touches only
`apps/web` — no `apps/api` changes (spec is UI-only, Clarifications).

**Performance Goals**: Not a throughput-sensitive feature — all data operations are synchronous,
in-memory array mutations; no network latency exists in this iteration by construction.

**Constraints**: Must visually conform to the established design system — no new visual identity, no
new shared component library (spec FR-016). Every mock data shape must mirror spec 023/024's real API
shapes exactly (course fields, content-item payload-per-type shapes) so the named follow-up wiring spec
is a drop-in swap of the mock store's functions for real `fetch` calls, not a redesign.

**Scale/Scope**: 4-5 new Next.js routes; one new shared mock-data-store module; one new drag-and-drop
dependency; zero new backend routes, zero new permissions, zero new `@tm/ui` package exports (page-scoped
components only, research.md §2).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (Tenant Isolation)**: N/A for this iteration — no backend calls exist, so there is no
  tenant-scoped data access to isolate; the follow-up wiring spec inherits spec 023/024/027's already
  tenant-scoped, RLS-enforced endpoints unchanged.
- **Principle II/III (Tenant-configurable, not fixed)**: PASS — no new permission keys; the 6
  content-item types are fixed platform-wide, matching spec 024's own precedent.
- **Principle IV (Spec-Before-Code)**: PASS — this plan follows a ratified, `/speckit-clarify`'d spec
  (the UI-only/mock-data/simulated-SCORM-upload scope was resolved explicitly before planning); no
  invented-in-code ambiguity remains.
- **Principle V (Design system)**: PASS — reuses the established Desktop Shell Visual Language and
  `@tm/ui` throughout (spec FR-016); no new visual identity or shared component library proposed. New
  page-scoped interactive components (category combobox, drag-and-drop outline, content-type picker) are
  built locally within this feature's own directory, following existing visual tokens, not added to
  `@tm/ui` — flagged as candidates for future promotion into the shared library if reused elsewhere,
  not decided here.
- **Principle VI (Plan-tier aware)**: N/A — this spec's "Generate with AI" entry is a non-functional
  placeholder (spec FR-002); the constitution's own AI-Course-Generation plan-tier gate applies to the
  future spec that builds real generation, not to this placeholder.
- **Principle VII (White-labeling)**: N/A — no branding/tenant-structural-config surface touched.
- **Principle VIII (Comprehensive-version rule)**: N/A — no scope-narrowing tradeoff arose beyond the
  explicit, user-directed UI-only/no-API decision already recorded in spec Clarifications.
- **Principle IX (Demoable vs. internal)**: Demoable, with the explicit caveat (spec Constitution
  Alignment) that this iteration is a UI-only mock, not backed by real persisted data — that distinction
  must be stated plainly whenever this is shown to a stakeholder.
- **Principle X (Clean branch)**: PASS — `028-course-creation-ui` branched from a clean `master` (which
  includes specs 025-027).
- **Principle XI (Fixed stack)**: PASS — Next.js frontend, no new runtime/framework.
- **Principle XII/XIII (No new dependency without justification/sign-off)**: PASS — one new dependency
  (`@dnd-kit/core` + `@dnd-kit/sortable`), correctly flagged with justification and explicitly approved
  (see Technical Context above) rather than silently added. `@dnd-kit/utilities` (that package's own
  standard companion, research.md §1) was added during implementation as a same-scope addendum.

No violations. Complexity Tracking table below is empty.

## Project Structure

### Documentation (this feature)

```text
specs/028-course-creation-ui/
├── plan.md                # This file
├── research.md             # Phase 0 output
├── data-model.md           # Phase 1 output
├── quickstart.md           # Phase 1 output
├── contracts/
│   └── mock-course-data-service.md
└── tasks.md                 # Phase 2 output (/speckit-tasks — not created by this command)
```

### Source Code (repository root)

```text
apps/web/
├── lib/
│   └── mock-course-data.ts                       # NEW: in-memory store (courses/categories/modules/
│                                                   #      content items) + useSyncExternalStore hook
├── app/(dashboard-shell)/learning/courses/
│   ├── page.tsx                                   # NEW: course list (Server Component, session check)
│   ├── courses-list-client.tsx                    # NEW: Client Component — list + "Create a course" CTA
│   ├── new/
│   │   ├── page.tsx                               # NEW: entry screen (Create manually / Generate with AI)
│   │   ├── entry-client.tsx                       # NEW: Client Component for the entry choice
│   │   └── manual/
│   │       ├── page.tsx                           # NEW: setup form (Server Component, session check)
│   │       └── setup-form-client.tsx               # NEW: Client Component — title/category/etc. form
│   └── [courseId]/
│       ├── page.tsx                                # NEW: course editor (Server Component, session check)
│       ├── course-editor-client.tsx                 # NEW: Client Component — header/status + tabs shell
│       ├── details-tab.tsx                          # NEW: setup fields, editable (reused from setup form)
│       ├── curriculum-tab.tsx                       # NEW: outline + editing panel, drag-and-drop
│       ├── content-item-type-picker.tsx             # NEW: the 6-type picker
│       ├── content-item-forms/
│       │   ├── video-form.tsx                       # NEW
│       │   ├── article-form.tsx                     # NEW
│       │   ├── live-class-form.tsx                  # NEW
│       │   ├── test-assignment-form.tsx              # NEW: shared shell for test + assignment
│       │   └── external-import-form.tsx              # NEW: URL sub-choice + simulated SCORM upload
│       └── category-combobox.tsx                    # NEW: autocomplete-with-create-option
└── package.json                                     # MODIFIED: + @dnd-kit/core, @dnd-kit/sortable
```

**Structure Decision**: One new route tree under the existing `(dashboard-shell)/learning/` group
(alongside `training-requests/`), following the same Server-Component-session-check +
Client-Component-interactivity split already used there and by the SCORM launcher (spec 027). One new
`apps/web/lib/` module for the mock data store, mirroring `tenant-session.ts`'s placement. No `apps/api`
changes at all (spec is UI-only). No new `@tm/ui` package exports (Constitution Check, Principle V).

## Complexity Tracking

*No Constitution Check violations — table intentionally empty.*
