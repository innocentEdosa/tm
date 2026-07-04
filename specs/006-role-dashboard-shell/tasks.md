---

description: "Task list for implementing the Role-Based Dashboard Shell feature"
---

# Tasks: Role-Based Dashboard Shell

**Input**: Design documents from `/specs/006-role-dashboard-shell/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md,
data-model.md, contracts/ (`tenant-auth-me-amendment.md`), quickstart.md

**Tests**: Included on the `apps/api` side — the `/tenant-auth/me` amendment touches permission
resolution, matching Specs 3–5's precedent of proving these mechanisms against real Postgres, no
mocks. **Not included** on the `apps/web` side — no test runner exists there today (unchanged decision
from Spec 4 research.md §6, restated in this spec's plan.md Testing); the new shell is verified via
`quickstart.md`'s manual/browser scenarios instead.

**Dependency sign-off status**: None needed — this feature adds no new package (research.md,
plan.md Technical Context, "New Dependencies Requiring Justification: None"). Sidebar icons are
hand-authored inline SVG. No task in this list should run `pnpm add`.

## Format: `[ID] [P?] [Story?] Description with file path (Backend-only | Frontend)`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Maps the task to its user story (US1–US2); Setup/Foundational/Polish tasks carry no
  story label

---

## Phase 1: Setup

- [X] T001 Confirm no new dependencies are required for this feature (research.md, plan.md Technical
  Context) — sidebar icons are hand-authored inline SVG (no icon package), and every data need is
  covered by extending an existing endpoint. A documentation/gate check, not a code change.
  (Backend-only)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The amended session endpoint and shared session helper every user story depends on.
**Nothing in Phase 3+ can start until this phase is complete.**

- [X] T002 Amend `GET /tenant-auth/me` in `apps/api/src/tenant-auth/tenant-auth-routes.ts`: add a
  query joining `user_roles` → `roles` → `role_permissions` → `permissions` (scoped through
  `request.tenantDb`, already RLS-restricted — mirrors the join shape in
  `apps/api/src/permissions/require-permission.ts`), reduce the permission keys through the existing
  `resolveEffectivePermissions()` helper (`apps/api/src/permissions/effective-permissions.ts`), and
  add `roleName: string | null` (first `user_roles` row by `created_at`; `null` if zero roles) and
  `permissions: string[]` to the response (contracts/tenant-auth-me-amendment.md). Additive only — do
  not change the meaning of `id`/`email`/`mustChangePassword`. (Backend-only)
- [X] T003 [P] Write `apps/api/tests/integration/tenant-auth-me-role-permissions.test.ts`: seed a
  tenant user with a role that has known permissions, log in, call `/tenant-auth/me`, and assert
  `roleName` and `permissions` match; separately seed a user with zero `user_roles` rows and assert
  `roleName: null` and `permissions: []`. Depends on T002. (Backend-only)
- [X] T004 [P] Create `apps/web/lib/tenant-session.ts`: a shared server-side helper (research.md §8)
  that reads the `tm_tenant_session` cookie via `next/headers` `cookies()`, calls
  `{API_ORIGIN}/tenant-auth/me?subdomain=...` server-to-server (mirroring the existing pattern in
  `apps/web/app/tenant/page.tsx`), and returns a typed discriminated result the caller can branch on:
  no/invalid session, valid session with `mustChangePassword: true`, or valid session with
  `mustChangePassword: false` (carrying `email`, `roleName`, `permissions`). Depends on T002 for the
  final response shape. (Frontend)

**Checkpoint**: Foundation ready — the amended `/me` endpoint and shared session helper exist; user
story implementation can now begin.

---

## Phase 3: User Story 1 - Land directly on a persistent dashboard shell after login (Priority: P1) 🎯 MVP

**Goal**: Any successfully authenticated user lands directly on a persistent dashboard shell
(sidebar + main content area) immediately after login — no shared generic landing page shown first.

**Independent Test**: Log in as any team member and confirm the browser lands directly on
`/dashboard` (sidebar visible, placeholder content rendered), with no intermediate generic page.

### Implementation for User Story 1

- [X] T005 [US1] Create `apps/web/app/dashboard/layout.tsx` (Server Component): use
  `tenant-session.ts` (T004) to read the session; redirect to `/tenant` if no valid session, redirect
  to `/set-password` if `mustChangePassword: true`; if `roleName` is `null` (FR-008), render a clear
  "Your account isn't assigned a role yet — contact your HR Admin" error state instead of the shell;
  otherwise render `<DashboardSidebar />` (T006) alongside `{children}`. Depends on T004.
- [X] T006 [P] [US1] Create `apps/web/app/dashboard/dashboard-sidebar.tsx` (Client Component):
  persistent sidebar panel styled per `design-system/tm/MASTER.md`, initially rendering a single
  "Home" entry (always visible, links to `/dashboard`, active-state highlighting) — extended with
  permission-gated entries in User Story 2 (research.md §6, §5).
- [X] T007 [P] [US1] Create `apps/web/app/dashboard/page.tsx`: the shared "more to come" empty-state
  main content (FR-003) — one honest, intentionally-designed placeholder identical for every role, no
  fabricated data of any kind.
- [X] T008 [US1] Amend `apps/web/app/tenant/tenant-login-form.tsx`: change the successful,
  non-must-change-password login redirect target from `/tenant` to `/dashboard`.
- [X] T009 [US1] Amend `apps/web/app/set-password/set-password-form.tsx`: change the successful
  submission redirect target from `/tenant` to `/dashboard`.
- [X] T010 [US1] Amend `apps/web/app/tenant/page.tsx`: replace its inline cookie-read/fetch logic with
  `tenant-session.ts` (T004); when the session is valid and `mustChangePassword: false`, `redirect()`
  to `/dashboard` instead of rendering `TenantAuthenticatedView`. Depends on T004.
- [X] T011 [US1] Amend `apps/web/app/set-password/page.tsx`: replace its inline cookie-read/fetch
  logic with `tenant-session.ts` (T004) — same external behavior, de-duplicated implementation.
  Depends on T004.
- [X] T012 [US1] Delete `apps/web/app/tenant/tenant-authenticated-view.tsx` — superseded by
  `/dashboard` (research.md §7). Depends on T010.

**Checkpoint**: At this point, User Story 1 is fully functional and testable independently — every
login lands directly on the dashboard shell (Home-only sidebar, shared placeholder content), with no
intermediate generic page.

---

## Phase 4: User Story 2 - Sidebar reflects what the user actually has access to (Priority: P2)

**Goal**: The sidebar shows navigation entries the logged-in user actually has permission to use —
real links into existing pages (Team Members, Authentication Settings) for permitted users, omitted
for everyone else — plus one always-visible, permission-independent "coming soon" entry proving that
pattern works.

**Independent Test**: Log in as an HR Admin (has `manage_team_members` and
`manage_authentication_settings`) and as an Employee/Learner (has neither), and confirm the sidebar's
entries differ accordingly.

### Implementation for User Story 2

- [X] T013 [US2] Extend `apps/web/app/dashboard/dashboard-sidebar.tsx` (T006, same file, sequential):
  add a "Team Members" entry (visible only when `permissions` includes `manage_team_members`, links
  to `/settings/team`), an "Authentication Settings" entry (visible only when `permissions` includes
  `manage_authentication_settings`, links to `/settings/authentication`), and a "Courses" entry
  (always visible, rendered in a disabled/"Coming soon" state, never a real link) — per
  data-model.md's sidebar-entry table. Depends on T006.
- [X] T014 [US2] Amend `apps/web/app/dashboard/layout.tsx` (T005, same file, sequential): pass
  `roleName` and `permissions` from the session helper's result down into `<DashboardSidebar />`
  props. Depends on T005, T002 (needs the amended `/me` response shape).

**Checkpoint**: All user stories are now independently functional — an HR Admin's sidebar shows Team
Members + Authentication Settings + the disabled Courses entry; an Employee/Learner's sidebar shows
only Home + the disabled Courses entry.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [X] T015 Run the full `apps/api` test suite (`pnpm vitest run`) to confirm the `/tenant-auth/me`
  amendment introduces no regressions in existing tests that call it
  (`tenant-auth-otp-forces-change.test.ts`, `tenant-auth-cross-tenant-session.test.ts`).
- [X] T016 [P] Run `pnpm type-check` and `pnpm lint` in `apps/web` against all new/amended files
  (`app/dashboard/**`, `lib/tenant-session.ts`, `app/tenant/**`, `app/set-password/**`).
- [X] T017 Run `quickstart.md`'s three scenarios end-to-end in a real browser (HR Admin sidebar,
  reduced Employee/Learner sidebar, defensive missing-role state) and the tenant-isolation check.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational (T002, T004) completion.
- **User Story 2 (Phase 4)**: Depends on Foundational (T002) AND User Story 1's sidebar/layout files
  existing (T005, T006) — it extends the same two files rather than creating new ones.
- **Polish (Phase 5)**: Depends on both user stories being complete.

### Within Each Phase

- T003 and T004 can run in parallel once T002 is merged (different files, both only need T002's
  response shape, not each other).
- T006 and T007 can run in parallel (different files, no dependency on each other).
- T013 and T014 both touch files T006/T005 already created — sequential with respect to those files,
  but independent of each other in principle (could still be done as one combined change).

### Parallel Opportunities

- T003 [P] and T004 [P] together, once T002 is done.
- T006 [P] and T007 [P] together, within User Story 1.
- T016 [P] can run any time after the relevant files exist, independent of T015/T017.

---

## Parallel Example: Foundational Phase

```bash
# Once T002 (amended /tenant-auth/me) is done, launch together:
Task: "Write apps/api/tests/integration/tenant-auth-me-role-permissions.test.ts"
Task: "Create apps/web/lib/tenant-session.ts"
```

## Parallel Example: User Story 1

```bash
# These have no dependency on each other:
Task: "Create apps/web/app/dashboard/dashboard-sidebar.tsx (Home entry only)"
Task: "Create apps/web/app/dashboard/page.tsx (shared placeholder content)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001).
2. Complete Phase 2: Foundational (T002–T004) — CRITICAL, blocks all stories.
3. Complete Phase 3: User Story 1 (T005–T012).
4. **STOP and VALIDATE**: log in and confirm direct landing on `/dashboard` with a Home-only sidebar
   and the shared placeholder content — this alone is a complete, demoable MVP (every login already
   avoids the old generic `/tenant` confirmation page).
5. Demo if ready.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. User Story 1 → test independently → demo (MVP).
3. User Story 2 → test independently → demo (full feature).
4. Polish → final validation pass.
