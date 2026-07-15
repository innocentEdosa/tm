---

description: "Task list for implementing the Split-Screen Tenant Login Layout feature"
---

# Tasks: Split-Screen Tenant Login Layout

**Input**: Design documents from `/specs/017-fix-login-ui/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md,
data-model.md, contracts/ (`tenant-login-layout-contract.md`), quickstart.md

**Tests**: Not included — no `apps/api` changes, and no test runner exists in `apps/web` (unchanged
decision carried since Spec 4/Spec 8). Verified via `quickstart.md`'s manual/browser scenarios,
including re-running the Tenant Authentication Configuration spec's (005) own quickstart to confirm no
functional regression.

**Dependency sign-off status**: None needed — no new dependency of any kind (plan.md Technical
Context). No task in this list should run `pnpm add`.

## Format: `[ID] [P?] [Story?] Description with file path`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Maps the task to its user story (US1, US2); Setup/Foundational/Polish tasks carry no
  story label

---

## Phase 1: Setup

No setup tasks — no new dependencies, scaffolding, or project initialization required (research.md;
plan.md Technical Context). Proceed directly to Foundational.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The CSS scaffold both user stories build on.
**Nothing in Phase 3+ can start until this phase is complete.**

- [X] T001 Amend `apps/web/app/globals.css`: add `.login-split` (flex, `min-h-screen`, full-height
  two-region wrapper matching the existing `.shell` convention — research.md §5), `.login-brand-panel`
  (`hidden lg:flex`, fixed-fraction width, `bg-primary`, `relative overflow-hidden`, flex column,
  generous padding — research.md §1), `.login-brand-panel-glow` (absolutely-positioned, blurred
  gradient circle(s) using `--color-cta` at low opacity), `.login-brand-shape` (translucent
  rounded-rectangle blocks — `bg-white/5`, hairline `border-white/10` — for the decorative
  composition), and `.login-form-column` (flex, `flex-1`, centers its content, full width below `lg`)
  — all reusing only existing `--color-primary` / `--color-cta` / `--color-surface` / `--color-border`
  tokens, no new tokens defined (research.md §3, §5; data-model.md; spec FR-006).

**Checkpoint**: Foundation ready — the CSS scaffold exists; user story implementation can now begin.

---

## Phase 3: User Story 1 - Tenant user lands on a more polished, on-brand login screen (Priority: P1) 🎯 MVP

**Goal**: On desktop-width viewports, the tenant login page renders as a two-column layout — brand
panel (identity, headline, supporting sentence, decorative graphic) on the left, the existing,
functionally-unchanged login form in a column on the right.

**Independent Test**: Visit a tenant subdomain signed out on a desktop-width viewport; confirm both
columns render, and confirm sign-in (success, invalid-credential, no-method, SSO-placeholder paths)
behaves exactly as before (contracts/tenant-login-layout-contract.md).

### Implementation for User Story 1

- [X] T002 [US1] Amend `apps/web/app/tenant/tenant-login-form.tsx`: wrap the component's returned JSX
  in the new `.login-split` container. Move the entire existing form-column subtree (the `<h1>`, the
  error banner, the `<form>`, the divider, the SSO button list, and the no-method message) unchanged
  into a new `.login-form-column` div — zero changes to any prop, state variable, handler, or
  conditional-rendering logic (contracts/tenant-login-layout-contract.md "MUST stay byte-for-byte
  identical" list). Depends on T001.
- [X] T003 [US1] In the same file, add the brand panel markup as the first child of `.login-split`,
  before the form column: a `.login-brand-panel` containing (a) the tenant's identity, rendered from
  the existing `tenantName` prop styled consistently with the dashboard shell's
  `shell-sidebar-wordmark` precedent, (b) the fixed headline "Empower Your Team to Learn, Grow, and
  Succeed.", and (c) the fixed supporting sentence "Sign in to build training, track employee
  progress, and grow your team's skills — all in one place." (research.md §4; spec FR-002, FR-008).
  Depends on T001, T002.
- [X] T004 [US1] In the same file, add the decorative graphic to the brand panel's lower area: 2–3
  `.login-brand-panel-glow` blurred gradient shapes layered behind 2–3 `.login-brand-shape`
  translucent rounded-rectangle blocks, loosely arranged — no text, numbers, chart lines, or any
  content that could read as real product data or a dashboard mockup (research.md §3; spec FR-003).
  Depends on T001, T003.
- [X] T005 [US1] In the same file, apply `truncate` to the brand panel's tenant-identity line and
  confirm the headline/supporting sentence wrap normally, and confirm the form column's existing
  "Welcome to {tenantName}" heading also truncates/wraps — so an unusually long tenant name cannot
  overflow either column (spec FR-010, Edge Cases). Depends on T003.

**Checkpoint**: User Story 1 is fully functional and independently testable — desktop split-screen
renders, login form behaves identically to before.

---

## Phase 4: User Story 2 - Layout stays usable on narrow screens (Priority: P2)

**Goal**: Below the `lg` (1024px) breakpoint, the brand panel is not shown and the login form expands
to a full-width, centered presentation matching today's pre-change single-column layout.

**Independent Test**: Resize the viewport below 1024px; confirm the brand panel disappears, the form
becomes the page's only full-width content, and no horizontal scrollbar appears at any width down to
~320px (quickstart.md Scenario 3).

### Implementation for User Story 2

- [X] T006 [US2] In `apps/web/app/tenant/tenant-login-form.tsx`, confirm/adjust the brand panel's
  `hidden lg:flex` visibility and the `.login-form-column`'s width classes so that below `lg` the form
  column occupies the full page width with its existing inner `max-w-sm` content wrapper still
  centered — matching the page's pre-change single-column presentation exactly (research.md §1; spec
  FR-007). Depends on T002, T003.
- [X] T007 [US2] Manually verify (quickstart.md Scenario 3) that no horizontal scrollbar appears at any
  viewport width from ~320px up to the 1024px breakpoint; adjust padding/width classes on
  `.login-split` / `.login-form-column` in `apps/web/app/globals.css` (T001) if any overflow is found.
  Depends on T006.

**Checkpoint**: Both user stories are functional — desktop split-screen and mobile single-column both
work correctly.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end verification that this presentation-only change introduced zero functional
regression and stayed within the locked design system.

- [X] T008 [P] Run `quickstart.md` Scenarios 1–4 end-to-end against a running dev tenant: desktop
  split-screen render, unchanged form behavior (success/invalid-credential/no-method/SSO-placeholder
  paths), responsive collapse, and long-tenant-name handling.
- [X] T009 [P] Re-run the Tenant Authentication Configuration spec's (005) existing quickstart
  scenarios through the new layout to confirm zero functional regression
  (contracts/tenant-login-layout-contract.md Verification).
- [X] T010 Visual check: confirm the brand panel uses only `--color-primary` / `--color-cta` /
  `--color-surface` / `--color-border` and Plus Jakarta Sans — no colors or fonts outside
  `apps/web/app/globals.css`'s locked design system (spec SC-004).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: None — empty, no blocking effect.
- **Foundational (Phase 2)**: No dependencies — BLOCKS both user stories (T002 onward all depend on
  T001's CSS classes existing).
- **User Story 1 (Phase 3)**: Depends on Foundational (T001). No dependency on User Story 2.
- **User Story 2 (Phase 4)**: Depends on Foundational (T001) and on T002/T003 from User Story 1 (the
  brand panel and form column must exist before their responsive visibility can be adjusted) — not
  independently implementable before US1's markup exists, but independently *testable* once both are
  in place (resizing the viewport is a standalone verification step).
- **Polish (Phase 5)**: Depends on both user stories being complete.

### Within Each User Story

- T002 (wrap existing form markup) before T003 (add brand panel) before T004 (add decorative graphic)
  — all in the same file, sequential, no parallelism.
- T005 (long-name handling) depends on T003 (brand panel identity markup must exist first).
- T006 (responsive visibility) depends on T002 and T003 (both columns must exist to toggle between
  them). T007 (overflow check) depends on T006.

### Parallel Opportunities

- T008, T009, T010 (Polish phase) can run in parallel — each is an independent verification pass with
  no file conflicts.
- No other tasks are parallelizable: every implementation task (T001–T007) edits one of two shared
  files (`globals.css`, `tenant-login-form.tsx`) with a strict ordering dependency on the task before
  it.

---

## Parallel Example: Polish Phase

```bash
# Launch all Polish verification passes together:
Task: "Run quickstart.md Scenarios 1-4 end-to-end against a running dev tenant"
Task: "Re-run the Tenant Authentication Configuration spec's (005) quickstart through the new layout"
Task: "Visual check: brand panel uses only locked design-system tokens and fonts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: Foundational (T001)
2. Complete Phase 3: User Story 1 (T002–T005)
3. **STOP and VALIDATE**: Confirm the desktop split-screen renders correctly and every login path
   (success, invalid credentials, no-method, SSO placeholder) still behaves identically
4. Demo if ready — the mobile viewport will simply show the split layout unmodified at this point
   (visually degraded but not broken, since Tailwind's `flex` wrapper still renders linearly without
   T006's `hidden lg:flex` narrowing applied)

### Incremental Delivery

1. Foundational → CSS scaffold ready
2. Add User Story 1 → validate desktop layout + unchanged form behavior → demo (MVP!)
3. Add User Story 2 → validate mobile collapse → demo
4. Polish → full quickstart + regression pass → ship

---

## Notes

- [P] tasks = different files, no dependencies — in this feature, that only applies within the Polish
  phase; every other task touches one of two shared files in a fixed order.
- [Story] label maps task to specific user story for traceability.
- This feature intentionally has tight file-level coupling between US1 and US2 (both live in the same
  ~150-line component) — independence here means independently *testable*, not independently
  *implementable* in parallel, per spec.md's own Independent Test framing for each story.
- Commit after each task or logical group.
- Stop at either checkpoint to validate that story independently before continuing.
