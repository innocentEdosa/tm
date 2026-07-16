---

description: "Task list for implementing the Split-Screen Change Password Layout feature"
---

# Tasks: Split-Screen Change Password Layout

**Input**: Design documents from `/specs/018-fix-change-password-ui/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md,
data-model.md, contracts/ (`set-password-layout-contract.md`), quickstart.md

**Tests**: Not included — no `apps/api` changes, and no test runner exists in `apps/web` (unchanged
decision carried since Spec 4/Spec 8, reaffirmed by `017-fix-login-ui`). Verified via `quickstart.md`'s
manual/browser scenarios, including re-running the Tenant Authentication Configuration spec's (005)
relevant quickstart scenarios to confirm no functional regression.

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

**Purpose**: The one new piece of data (workspace name) both user stories' form-column content depends
on, plus the shared-CSS documentation update.
**Nothing in Phase 3+ can start until this phase is complete.**

- [X] T001 Amend `apps/web/app/set-password/page.tsx`: read the `x-tenant-name` request header
  (already set by `apps/web/middleware.ts`), falling back to `subdomain` if absent — the identical
  pattern `(dashboard-shell)/layout.tsx` already uses — and pass it as a new `tenantName` prop to
  `<SetPasswordForm subdomain={subdomain} tenantName={tenantName} />`. Session-check/redirect logic
  (`getTenantSession`, `redirect("/tenant")`) is unchanged (data-model.md; research.md §5; spec FR-002).
- [X] T002 [P] Amend `apps/web/app/globals.css`: update the descriptive comment above `.login-split` /
  `.login-brand-panel` / `.login-brand-panel-glow` / `.login-brand-shape` / `.login-form-column` to note
  these classes are now shared by the tenant login page and the change-password page. No rule changes,
  no new classes, no new tokens (plan.md Project Structure; research.md §3).

**Checkpoint**: Foundation ready — `tenantName` is available to the form component; user story
implementation can now begin.

---

## Phase 3: User Story 1 - Tenant user completes the forced password change on a more polished screen (Priority: P1) 🎯 MVP

**Goal**: On desktop-width viewports, `/set-password` renders as a two-column layout — the existing,
functionally-unchanged password form in a column on the left (with a new workspace wordmark), and a
purely decorative visual panel on the right.

**Independent Test**: Sign in as a tenant user who must change their password on a desktop-width
viewport; confirm both columns render, and confirm the password-change flow (success, mismatched
passwords, server-rejection) behaves exactly as before
(contracts/set-password-layout-contract.md).

### Implementation for User Story 1

- [X] T003 [US1] Amend `apps/web/app/set-password/set-password-form.tsx`: accept the new
  `tenantName: string` prop. Wrap the component's returned JSX in the reused `.login-split` container.
  Move the entire existing content subtree (reassurance banner, heading, error banner, `<form>`, submit
  button) unchanged into a `.login-form-column` div placed as the **first** child of `.login-split`
  (left side — the mirror of `tenant-login-form.tsx`'s order) — zero changes to any state variable,
  handler, or validation logic (contracts/set-password-layout-contract.md "MUST stay byte-for-byte
  identical" list). Depends on T001.
- [X] T004 [US1] In the same file, render a workspace wordmark using the new `tenantName` prop at the
  top of `.login-form-column`, above the existing reassurance banner — styled consistently with
  `tenant-login-form.tsx`'s form-column heading precedent (`truncate`, `font-semibold`,
  `tracking-tight`) (spec FR-002; data-model.md). Depends on T003.
- [X] T005 [US1] In the same file, add the visual panel markup as the **second** child of
  `.login-split`, after the form column: a `.login-brand-panel` containing *only* the decorative
  composition — 2–3 `.login-brand-panel-glow` blurred gradient shapes layered behind 2–3
  `.login-brand-shape` translucent rounded-rectangle blocks — no headline, no supporting sentence, no
  wordmark, and no card of any kind (research.md §3, §4; spec FR-003). Depends on T002, T003.
- [X] T006 [US1] Confirm the visual panel renders **no** back-navigation control and **no**
  quote/testimonial card anywhere in the markup — both were explicitly ruled out via clarification
  (spec FR-009, FR-010). Depends on T005.
- [X] T007 [US1] Apply `truncate` (wrap-safe styling) to the new wordmark from T004 so an unusually long
  tenant name cannot overflow the form column or break the two-column layout (spec Edge Cases;
  quickstart.md Scenario 4). Depends on T004.

**Checkpoint**: User Story 1 is fully functional and independently testable — desktop split-screen
renders (form left, decorative panel right, no back control, no quote card), and the password-change
form behaves identically to before.

---

## Phase 4: User Story 2 - Layout stays usable on narrow screens (Priority: P2)

**Goal**: Below the `lg` (1024px) breakpoint, the visual panel is not shown and the password form
expands to a full-width, centered presentation matching today's pre-change single-column layout.

**Independent Test**: Resize the viewport below 1024px; confirm the visual panel disappears, the form
becomes the page's only full-width content, and no horizontal scrollbar appears at any width down to
~320px (quickstart.md Scenario 3).

### Implementation for User Story 2

- [X] T008 [US2] In `apps/web/app/set-password/set-password-form.tsx`, confirm/adjust the visual panel's
  `hidden lg:flex` visibility (inherited from the reused `.login-brand-panel` class) and
  `.login-form-column`'s width classes so that below `lg` the form column occupies the full page width
  with its existing inner `max-w-sm` content wrapper still centered — matching the page's pre-change
  single-column presentation exactly (research.md §1; spec FR-007). Depends on T003, T005.
- [X] T009 [US2] Manually verify (quickstart.md Scenario 3) that no horizontal scrollbar appears at any
  viewport width from ~320px up to the 1024px breakpoint; if any overflow is found, adjust only the
  shared `.login-split` / `.login-form-column` classes in `apps/web/app/globals.css` (T002) — no other
  class or token change permitted (spec FR-006). Depends on T008.

**Checkpoint**: Both user stories are functional — desktop split-screen and mobile single-column both
work correctly.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end verification that this presentation-only change introduced zero functional
regression and stayed within the locked design system.

- [X] T010 [P] Run `quickstart.md` Scenarios 1–4 end-to-end against a running dev tenant: desktop
  split-screen render (form left/panel right, no back control, no quote card), unchanged form behavior
  (mismatched-password error, successful redirect to `/dashboard`, server-rejection error), responsive
  collapse, and long-tenant-name handling.
- [X] T011 [P] Re-run the Tenant Authentication Configuration spec's (005) relevant quickstart scenario
  (OTP-bootstrap forced password change → redirect to `/dashboard`) through the new layout to confirm
  zero functional regression (contracts/set-password-layout-contract.md Verification).
- [X] T012 [P] Visual check: confirm the visual panel and wordmark use only `--color-primary` /
  `--color-cta` and Plus Jakarta Sans — no colors or fonts outside `apps/web/app/globals.css`'s locked
  design system, and specifically none of the reference screenshot's black/white/beige tones (spec
  SC-004, FR-006).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: None — empty, no blocking effect.
- **Foundational (Phase 2)**: No dependencies — BLOCKS both user stories (T003 onward depends on T001's
  `tenantName` prop; T005 depends on T002's shared-CSS documentation being current, though the classes
  themselves already exist).
- **User Story 1 (Phase 3)**: Depends on Foundational (T001, T002). No dependency on User Story 2.
- **User Story 2 (Phase 4)**: Depends on Foundational and on T003/T005 from User Story 1 (the form
  column and visual panel must exist before their responsive visibility can be adjusted) — not
  independently implementable before US1's markup exists, but independently *testable* once both are in
  place (resizing the viewport is a standalone verification step).
- **Polish (Phase 5)**: Depends on both user stories being complete.

### Within Each User Story

- T003 (wrap existing form markup) before T004 (add wordmark) and before T005 (add visual panel) — all
  in the same file, sequential, no parallelism.
- T006 (confirm no back control/quote card) depends on T005 (panel markup must exist to inspect).
- T007 (long-name handling) depends on T004 (wordmark markup must exist first).
- T008 (responsive visibility) depends on T003 and T005 (both columns must exist to toggle between
  them). T009 (overflow check) depends on T008.

### Parallel Opportunities

- T002 (Foundational) can run in parallel with T001 — different files (`globals.css` vs. `page.tsx`).
- T010, T011, T012 (Polish phase) can run in parallel — each is an independent verification pass with no
  file conflicts.
- No other tasks are parallelizable: every implementation task (T003–T009) edits the same file
  (`set-password-form.tsx`) with a strict ordering dependency on the task before it.

---

## Parallel Example: Foundational Phase

```bash
# Launch both Foundational tasks together:
Task: "Amend apps/web/app/set-password/page.tsx to read x-tenant-name and pass tenantName prop"
Task: "Amend apps/web/app/globals.css comment to note the split-screen classes are now shared"
```

## Parallel Example: Polish Phase

```bash
# Launch all Polish verification passes together:
Task: "Run quickstart.md Scenarios 1-4 end-to-end against a running dev tenant"
Task: "Re-run the Tenant Authentication Configuration spec's (005) relevant quickstart scenario"
Task: "Visual check: visual panel and wordmark use only locked design-system tokens and fonts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: Foundational (T001, T002)
2. Complete Phase 3: User Story 1 (T003–T007)
3. **STOP and VALIDATE**: Confirm the desktop split-screen renders correctly (form left, decorative
   panel right, no back control, no quote card) and every password-change path (success, mismatched
   passwords, server-rejection) still behaves identically
4. Demo if ready — the mobile viewport will simply show the split layout unmodified at this point
   (visually degraded but not broken, since the reused `flex` wrapper still renders linearly without
   T008's `hidden lg:flex` narrowing applied)

### Incremental Delivery

1. Foundational → `tenantName` prop threaded, shared-CSS comment updated
2. Add User Story 1 → validate desktop layout + unchanged form behavior → demo (MVP!)
3. Add User Story 2 → validate mobile collapse → demo
4. Polish → full quickstart + regression pass → ship

---

## Notes

- [P] tasks = different files, no dependencies — in this feature, that applies to the Foundational
  phase (T001/T002) and the Polish phase; every other task touches the same single component file in a
  fixed order.
- [Story] label maps task to specific user story for traceability.
- This feature intentionally has tight file-level coupling between US1 and US2 (both live in the same
  ~90-line component) — independence here means independently *testable*, not independently
  *implementable* in parallel, per spec.md's own Independent Test framing for each story.
- Commit after each task or logical group.
- Stop at either checkpoint to validate that story independently before continuing.
