---

description: "Task list for implementing the Desktop Shell Visual Language feature"
---

# Tasks: Desktop Shell Visual Language

**Input**: Design documents from `/specs/008-desktop-shell-visual-language/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md,
data-model.md, contracts/ (`shell-component-contract.md`), quickstart.md

**Tests**: Not included — this feature makes zero `apps/api` changes and no test runner exists in
`apps/web` (unchanged decision carried since Spec 4). Verified via `quickstart.md`'s manual/browser
scenarios, including re-running the Role-Based Dashboard Shell and Super Admin Platform Dashboard
specs' own quickstarts to confirm no functional regression.

**Dependency sign-off status**: One addition — `next` as a `packages/ui` peerDependency (matching the
existing `react` peerDependency). Triggers no install (`apps/web` already provides `next` at the
workspace root) — see plan.md Technical Context and research.md §3 for the full justification. No
task in this list should run `pnpm add` for a real new package.

## Format: `[ID] [P?] [Story?] Description with file path`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Maps the task to its user story (US1–US3); Setup/Foundational/Polish tasks carry no
  story label

---

## Phase 1: Setup

- [X] T001 Add `next` as a peerDependency (not a direct dependency) to `packages/ui/package.json`,
  matching the existing `react` peerDependency entry — no `pnpm add` install needed, since `apps/web`
  already provides `next` at the workspace root (research.md §3, plan.md Technical Context).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared components and CSS every user story depends on.
**Nothing in Phase 3+ can start until this phase is complete.**

- [X] T002 [P] Create `packages/ui/src/card.tsx`: a `Card` component wrapping `children` with rounded
  corners, hairline border, consistent internal padding, no shadow (data-model.md, FR-012).
- [X] T003 [P] Create `packages/ui/src/badge.tsx`: a `Badge` component with a `variant` prop
  (`success | warning | neutral | accent`), rendering a pill shape with a tinted background and
  matching darker text per variant (data-model.md, FR-013).
- [X] T004 [P] Create `packages/ui/src/page-header.tsx`: a `PageHeader` component rendering a `title`
  and optional `subtitle` (data-model.md, FR-006).
- [X] T005 Amend `apps/web/app/globals.css`: (a) remove `.surface-card`'s `box-shadow`, keeping only
  rounded corners + hairline border (research.md §5, data-model.md); (b) add new shell CSS — icon
  rail, an always-expanded multi-group sidebar (replacing the current one-category-panel classes,
  research.md §1), a topbar region (breadcrumb, utility icons, identity badge), and a
  page-content-area class with standard padding; (c) add `.badge-success` / `.badge-warning` /
  `.badge-neutral` / `.badge-accent` variant classes for T003 to use. All new colors stay within the
  existing locked blue/navy palette (`design-system/tm/MASTER.md`) — no new hue introduced
  (Clarifications: blue, not purple/indigo).
- [X] T006 Create `packages/ui/src/app-shell.tsx` (Client Component): renders the icon rail,
  always-expanded grouped sidebar (each group independently collapsible, default expanded,
  research.md §1), topbar (breadcrumb, utility search/notification icons showing an inline "not
  available yet" notice on click — same precedent as the tenant login page's SSO stubs — and an
  identity badge), and a content slot for `children`. Calls `usePathname()` (`next/navigation`) and
  renders nav links with `next/link`'s `Link` internally (research.md §3) — active item is
  `pathname === item.href` exactly, no prefix matching (contracts/shell-component-contract.md).
  Collapse/expand state persists to `localStorage` under a caller-provided, namespaced key so the
  tenant and platform shells never clobber each other's collapsed state. Logout is handled internally
  from `logoutHref`/`afterLogoutHref` string props (`fetch` + redirect), not a function prop
  (research.md §4). Depends on T005.
- [X] T007 Amend `packages/ui/src/index.ts`: export `AppShell`, `Card`, `Badge`, `PageHeader`, and
  their prop types. Depends on T002, T003, T004, T006.

**Checkpoint**: Foundation ready — the shared shell and supporting components exist; user story
implementation can now begin.

---

## Phase 3: User Story 1 - A coherent shell renders with placeholder content (Priority: P1) 🎯 MVP

**Goal**: The tenant dashboard renders through `AppShell`, showing every structural region (icon
rail, expanded sidebar with at least one labeled group, topbar, content area with page-header
pattern) — proving the shell works end-to-end on at least one real consumer before converging the
second.

**Independent Test**: Log in as a tenant user and confirm the shell shows the icon rail, an
always-expanded sidebar with labeled group(s), a topbar (breadcrumb, utility icons, tenant identity
badge), and the dashboard content area using the `PageHeader` pattern.

### Implementation for User Story 1

- [X] T008 [US1] Amend `apps/web/app/(dashboard-shell)/layout.tsx`: build the tenant dashboard's
  `railItems`/`navGroups` (grouping existing nav items — Home, Team Members, Authentication Settings,
  Courses — into labeled groups per the sidebar's new always-expanded-groups shape, research.md §1),
  `identity` (role name + initial, as today), `breadcrumb`, and `logoutHref`/`afterLogoutHref`
  (`/tenant-api/tenant-auth/logout?subdomain=...`, `/tenant`), then render `<AppShell>` wrapping
  `{children}` instead of the old `<DashboardSidebar>` + raw `<main>`. Depends on T007.
- [X] T009 [US1] Delete `apps/web/app/(dashboard-shell)/dashboard-sidebar.tsx` — superseded by the
  shared `AppShell` (T006, T008). Depends on T008.
- [X] T010 [US1] Amend `apps/web/app/(dashboard-shell)/dashboard/page.tsx`: wrap its placeholder
  content with the new `PageHeader` component (title + subtitle) instead of its own ad hoc heading
  markup, proving the content-area page-header pattern (FR-006). Depends on T007.

**Checkpoint**: User Story 1 is fully functional and testable independently — the tenant dashboard
renders the complete new shell.

---

## Phase 4: User Story 2 - Both dashboards render through one shared shell (Priority: P1)

**Goal**: The Super Admin platform dashboard also renders through `AppShell` — proving convergence by
comparing it side by side with the tenant dashboard from User Story 1.

**Independent Test**: Log in as a Super Admin and confirm the platform dashboard's icon rail,
sidebar, and topbar are visually identical in structure and style to the tenant dashboard's (Scenario
1) — only nav items and identity badge content differ.

### Implementation for User Story 2

- [X] T011 [US2] Amend `apps/web/app/(platform-shell)/layout.tsx`: build the platform dashboard's
  `railItems`/`navGroups` (Home, Provision Tenant, Permissions, grouped per the same always-expanded
  shape as T008), `identity` (Super Admin name + initial, as today), `breadcrumb`, and
  `logoutHref`/`afterLogoutHref` (`/platform-api/platform/logout`, `/platform/login`), then render
  `<AppShell>` wrapping `{children}` instead of the old `<PlatformSidebar>` + raw `<main>`. Depends on
  T007.
- [X] T012 [US2] Delete `apps/web/app/(platform-shell)/platform-sidebar.tsx` — superseded by the
  shared `AppShell` (T006, T011). Depends on T011.
- [X] T013 [US2] Amend `apps/web/app/(platform-shell)/platform/page.tsx`: wrap its identity-summary
  content with `PageHeader`, matching T010's treatment on the tenant side. Depends on T007.

**Checkpoint**: User Stories 1 and 2 both work independently — both dashboards render through the
identical shared shell, differing only in nav content and identity badge (spec SC-001a).

---

## Phase 5: User Story 3 - Reusable card and status-badge patterns are available (Priority: P2)

**Goal**: The two existing places already using an ad hoc pill pattern (provisioning success summary,
permissions catalog) adopt the new `Badge` component — proving the pattern is genuinely reusable, not
just theoretically established.

**Independent Test**: Complete a tenant-provisioning run and confirm department tags render via
`Badge`; view the permissions catalog and confirm category/permission-key tags render via `Badge` —
both visually unchanged from today's ad hoc styling (same tinted-pill look), just implemented through
the shared component now.

### Implementation for User Story 3

- [X] T014 [P] [US3] Amend `apps/web/app/(platform-shell)/provisioning/new/page.tsx`: replace the
  success summary's inline `bg-cta/10 text-cta rounded-full` department-tag spans with
  `<Badge variant="accent">`. Depends on T007.
- [X] T015 [P] [US3] Amend `apps/web/app/(platform-shell)/admin/permissions/page.tsx`: replace the
  category-tag and permission-key-tag inline spans with `<Badge variant="accent">`. Depends on T007.

**Checkpoint**: All user stories are now independently functional — the shell is converged, and the
badge pattern is proven reusable on real existing content, not just a component that exists in
isolation.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T016 [P] Run `pnpm type-check` and `pnpm lint` in `apps/web`, and `pnpm type-check` in
  `packages/ui` if it has its own script, against all new/amended files — clear `apps/web/.next`
  first if stale route-type errors appear (observed pattern from prior specs' file moves).
- [X] T017 Run the full `apps/api` test suite (`pnpm vitest run`) as a final sanity check — expected
  to be entirely unaffected (zero backend changes).
- [X] T018 Run `quickstart.md`'s three scenarios end-to-end in a real browser (tenant shell, platform
  shell, card/badge patterns in isolation), plus re-run the Role-Based Dashboard Shell and Super Admin
  Platform Dashboard specs' own quickstarts to confirm no functional regression (Team Members,
  Authentication Settings, Provision Tenant, Permissions all still work through the new shell).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational (T007) completion.
- **User Story 2 (Phase 4)**: Depends on Foundational (T007) completion — independent of US1, but
  most meaningfully verified *after* US1 exists (its own Independent Test compares against it).
- **User Story 3 (Phase 5)**: Depends on Foundational (T007) completion — independent of US1/US2.
- **Polish (Phase 6)**: Depends on all desired user stories being complete.

### Within Each Phase

- T002, T003, T004 can run in parallel (different files, no shared dependency).
- T005 must complete before T006 (AppShell's markup references the new CSS classes).
- T008–T010 (US1) and T011–T013 (US2) touch entirely different files — the two stories can proceed
  in parallel once Foundational is done, even though US2's *test* is more meaningful once US1 exists.
- T014 and T015 (US3) are fully independent of each other and of US1/US2.

### Parallel Opportunities

- T002 [P], T003 [P], T004 [P] together, within Foundational.
- T014 [P] and T015 [P] together, within User Story 3.
- T016 [P] can run any time after the relevant files exist.

---

## Parallel Example: Foundational Phase

```bash
# These have no dependency on each other:
Task: "Create packages/ui/src/card.tsx"
Task: "Create packages/ui/src/badge.tsx"
Task: "Create packages/ui/src/page-header.tsx"
```

## Parallel Example: User Story 3

```bash
# Fully independent files:
Task: "Replace department-tag spans with Badge in provisioning/new/page.tsx"
Task: "Replace category/permission-key spans with Badge in admin/permissions/page.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001).
2. Complete Phase 2: Foundational (T002–T007) — CRITICAL, blocks all stories.
3. Complete Phase 3: User Story 1 (T008–T010).
4. **STOP and VALIDATE**: log in as a tenant user and confirm the full new shell renders correctly —
   already a demoable improvement (topbar didn't exist before; sidebar now shows grouped, always-
   visible nav).
5. Demo if ready.

### Incremental Delivery

1. Setup + Foundational → shared components ready.
2. User Story 1 → test independently → demo (tenant shell, MVP).
3. User Story 2 → test independently → demo (platform shell converged, side-by-side comparison).
4. User Story 3 → test independently → demo (badge pattern proven on real content).
5. Polish → final validation pass, including regression-checking both prior specs' quickstarts.
