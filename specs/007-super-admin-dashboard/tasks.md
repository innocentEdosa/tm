---

description: "Task list for implementing the Super Admin Platform Dashboard Shell feature"
---

# Tasks: Super Admin Platform Dashboard Shell

**Input**: Design documents from `/specs/007-super-admin-dashboard/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md,
data-model.md, contracts/ (`platform-me-reference.md`), quickstart.md

**Tests**: Not included — this feature makes zero `apps/api` changes (research.md §1), so there is
nothing new to test at the backend/integration level; no test runner exists in `apps/web` (unchanged
decision carried from Spec 4 research.md §6, restated in plan.md Testing). Verified via
`quickstart.md`'s manual/browser scenarios instead.

**Dependency sign-off status**: None needed — this feature adds no new package (plan.md Technical
Context, "New Dependencies Requiring Justification: None"). No task in this list should run
`pnpm add`.

## Format: `[ID] [P?] [Story?] Description with file path`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Maps the task to its user story (US1–US3); Setup/Foundational/Polish tasks carry no
  story label

---

## Phase 1: Setup

- [X] T001 Confirm no new dependencies are required for this feature (research.md, plan.md Technical
  Context) — every endpoint this shell surfaces already exists and is unmodified; the sidebar reuses
  `globals.css`'s existing `sidebar-*` classes verbatim. A documentation/gate check, not a code
  change.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared session helper, sidebar, and layout every user story depends on.
**Nothing in Phase 3+ can start until this phase is complete.**

- [X] T002 [P] Create `apps/web/lib/platform-session.ts`: mirrors `lib/tenant-session.ts`
  (research.md §2, §3) but for the platform level — reads the `tm_super_admin_session` cookie via
  `next/headers` `cookies()`, calls `{API_ORIGIN}/platform/me` server-to-server (no `subdomain` param
  — this helper is root-domain-only, FR-007), and returns a typed discriminated result:
  `{ authenticated: false }` or `{ authenticated: true, id, email, name, lastLoginAt }`
  (contracts/platform-me-reference.md).
- [X] T003 [P] Create `apps/web/app/(platform-shell)/platform-sidebar.tsx` (Client Component): the
  two-tier sidebar (research.md §4) reusing `globals.css`'s existing `sidebar-rail`/`sidebar-panel`/
  `sidebar-panel-item` classes verbatim (zero new CSS) — a "Home" entry (direct link to `/platform`,
  no panel), a "Platform Tools" category (button that expands a panel listing "Provision Tenant" →
  `/provisioning/new` and "Permissions" → `/admin/permissions`, both always shown — no permission
  gating exists at the platform level, research.md §5), a collapse toggle persisted to
  `localStorage` (same key pattern as the tenant sidebar, distinct key name), and a Log out control
  calling the existing `POST /platform/logout` through the `/platform-api/*` rewrite proxy.
- [X] T004 Create `apps/web/app/(platform-shell)/layout.tsx` (Server Component): use
  `platform-session.ts` (T002) to read the session; redirect to `/platform/login` if unauthenticated;
  otherwise render `<PlatformSidebar />` (T003) alongside `{children}`. No must-change-password or
  missing-role branch exists here (Super Admin has neither concept — research.md §5). Depends on
  T002, T003.

**Checkpoint**: Foundation ready — the shell frame exists; user story implementation can now begin
(each remaining task is "move + restyle one existing page into the shell").

---

## Phase 3: User Story 1 - Land directly on the platform dashboard shell after login (Priority: P1) 🎯 MVP

**Goal**: A Super Admin lands directly on the shell after login, seeing their identity summary as the
home content — no separate confirmation page.

**Independent Test**: Log in as a Super Admin and confirm the browser lands directly on `/platform`
inside the shell (sidebar visible) showing name/email/last login, with no intermediate page.

### Implementation for User Story 1

- [X] T005 [US1] Move `apps/web/app/platform/page.tsx` to
  `apps/web/app/(platform-shell)/platform/page.tsx`: convert from a Client Component that fetches
  `/platform-api/platform/me` itself (with its own loading/unauthenticated/error states and redirect)
  to a Server Component using `platform-session.ts` (T002) — the layout (T004) already guarantees a
  valid session before this renders, so the page can drop its own auth-check/redirect logic entirely
  and just render the identity summary (name, email, last login, Super Admin flag) restyled with the
  design system's `surface-card` and `banner-success` classes in place of the original ad hoc
  `gray-*`/`green-*` classes. Drop the page's own logout button (logout now lives in the sidebar,
  T003). Depends on T002, T004.

**Checkpoint**: User Story 1 is fully functional and testable independently — every Super Admin login
lands directly on the shell with a working identity-summary home view.

---

## Phase 4: User Story 2 - Provision a new tenant from the dashboard (Priority: P1)

**Goal**: The existing tenant-provisioning wizard is reachable from the shell's sidebar (Platform
Tools → Provision Tenant), restyled, with unchanged step flow/validation/submission behavior.

**Independent Test**: From the shell, open Platform Tools → Provision Tenant, complete all 3 existing
wizard steps with valid data, submit, and confirm the same success summary appears as before this
feature (restyled).

### Implementation for User Story 2

- [X] T006 [US2] Move `apps/web/app/provisioning/new/page.tsx` to
  `apps/web/app/(platform-shell)/provisioning/new/page.tsx`: restyle every form field, button, step
  indicator, review section, and success summary to use the design system's `field-input`/
  `field-label`/`field-error`/`field-hint`/`btn`/`btn-primary`/`btn-outline`/`surface-card`/
  `banner-error`/`banner-success` classes in place of the original ad hoc `gray-*`/`blue-600` classes.
  Keep all component state, validation functions (`companyErrors`, `departmentErrors`, `adminErrors`),
  step-navigation logic, and the `POST /provisioning/tenants` fetch call byte-for-byte unchanged —
  this is a presentation-only change (research.md §6, FR-003). Depends on T004.

**Checkpoint**: User Stories 1 and 2 both work independently — provisioning is now reachable from the
shell and visually consistent with it, with identical underlying behavior to before.

---

## Phase 5: User Story 3 - View the permissions and role-template catalog from the dashboard (Priority: P2)

**Goal**: The existing permission/role-template catalog view is reachable from the shell's sidebar
(Platform Tools → Permissions), restyled, with unchanged data and behavior.

**Independent Test**: From the shell, open Platform Tools → Permissions and confirm the same
permission/role-template data renders as before this feature (restyled).

### Implementation for User Story 3

- [X] T007 [US3] Move `apps/web/app/admin/permissions/page.tsx` to
  `apps/web/app/(platform-shell)/admin/permissions/page.tsx`: restyle to the design system's classes
  in place of the original ad hoc ones; keep all fetch/state logic unchanged (research.md §6, FR-004).
  Depends on T004.

**Checkpoint**: All user stories are now independently functional — Home, Provision Tenant, and
Permissions are all reachable from one persistent, restyled shell.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T008 [P] Run `pnpm type-check` and `pnpm lint` in `apps/web` against all new/moved files
  (`app/(platform-shell)/**`, `lib/platform-session.ts`) — remember to clear `apps/web/.next` first if
  stale route-type errors appear from the file moves (observed in the Role-Based Dashboard Shell spec
  for the same reason).
- [X] T009 Run the full `apps/api` test suite (`pnpm vitest run`) as a final sanity check — expected
  to be entirely unaffected (zero backend changes), confirming nothing else regressed.
- [X] T010 Run `quickstart.md`'s four scenarios end-to-end in a real browser (shell landing,
  provisioning through the shell, permissions catalog through the shell, collapse/persistence).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational (T002, T004) completion.
- **User Story 2 (Phase 4)**: Depends on Foundational (T004) completion — independent of US1.
- **User Story 3 (Phase 5)**: Depends on Foundational (T004) completion — independent of US1/US2.
- **Polish (Phase 6)**: Depends on all desired user stories being complete.

### Within Each Phase

- T002 and T003 can run in parallel (different files, neither depends on the other's content, both
  only need to agree on the session/props shape documented in contracts/data-model.md).
- T005, T006, and T007 are fully independent of each other (different files, each moves one
  pre-existing page) — they only share a dependency on T004 (the shell must exist to nest under).

### Parallel Opportunities

- T002 [P] and T003 [P] together, within Foundational.
- T005, T006, T007 could all be done in parallel by different people/passes once T004 is done — each
  touches a completely different existing page.
- T008 [P] can run any time after the relevant files exist.

---

## Parallel Example: Foundational Phase

```bash
# These have no dependency on each other:
Task: "Create apps/web/lib/platform-session.ts"
Task: "Create apps/web/app/(platform-shell)/platform-sidebar.tsx"
```

## Parallel Example: User Stories 1–3

```bash
# Once T004 (layout.tsx) exists, these three moves are fully independent:
Task: "Move apps/web/app/platform/page.tsx into the shell, restyled"
Task: "Move apps/web/app/provisioning/new/page.tsx into the shell, restyled"
Task: "Move apps/web/app/admin/permissions/page.tsx into the shell, restyled"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001).
2. Complete Phase 2: Foundational (T002–T004) — CRITICAL, blocks all stories.
3. Complete Phase 3: User Story 1 (T005).
4. **STOP and VALIDATE**: log in and confirm direct landing on the shell with a working identity
   summary — already a demoable improvement over today's bare confirmation page.
5. Demo if ready.

### Incremental Delivery

1. Setup + Foundational → shell frame ready.
2. User Story 1 → test independently → demo (MVP).
3. User Story 2 → test independently → demo (provisioning reachable from the shell).
4. User Story 3 → test independently → demo (full feature).
5. Polish → final validation pass.
