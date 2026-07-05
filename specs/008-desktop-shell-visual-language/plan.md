# Implementation Plan: Desktop Shell Visual Language

**Branch**: `008-desktop-shell-visual-language` | **Date**: 2026-07-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-desktop-shell-visual-language/spec.md`

## Summary

Build one shared `AppShell` component (plus `Card`, `Badge`, `PageHeader`) in `packages/ui`, replacing
both dashboards' separately hand-rolled sidebars (tenant and Super Admin) with a single
implementation — converging them per this spec's Clarifications. Adds a topbar that doesn't exist
today (breadcrumb, utility icons, static tenant/identity badge), moves the sidebar from
one-category-at-a-time to an always-visible, independently-collapsible grouped structure, and
formalizes card/badge patterns already used ad hoc in a few places. `AppShell` stays framework-light
(no `next` or `lucide-react` import inside `packages/ui`) via prop injection. No backend changes.

## Technical Context

**Language/Version**: TypeScript, Node.js (matches `apps/web`/`packages/ui`, unchanged)

**Primary Dependencies**: Next.js 15 (App Router, `apps/web`), React 19, `lucide-react` (already
installed, apps/web-side only) — all existing.

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: `packages/ui`
gains a `next` peerDependency (matching its existing `react` peerDependency) so `AppShell` can call
`usePathname()`/render `Link` directly — required because its consumers are Server Components that
cannot call client-only hooks themselves to pass the result down (research.md §3). A peer dependency
triggers no install and adds no real new package: `apps/web` already provides `next` at the workspace
root. `lucide-react` stays out of `packages/ui` via prop injection (icons passed as already-imported
components) — no change there.

**Storage**: N/A — no schema change, no new query. This feature reads no backend data at all
(data-model.md); it only restyles/restructures how already-resolved data (nav items, tenant/identity
names) is displayed.

**Testing**: No `apps/api` changes, so no new backend tests. No test runner exists in `apps/web`
(unchanged decision carried since Spec 4). Verified via `quickstart.md`'s manual/browser scenarios,
plus re-running the existing Role-Based Dashboard Shell and Super Admin Platform Dashboard specs'
own quickstarts to confirm no functional regression from the restructuring.

**Target Platform**: Web (unchanged).

**Project Type**: Web application — this feature's only new code lives in `packages/ui` (shared
component library) and `apps/web` (the two dashboard layouts that consume it).

**Performance Goals**: No feature-specific target — purely a rendering/styling change, no new network
calls.

**Constraints**: `AppShell` must render identically for both consumers given equivalent props, with
zero internal "which dashboard is this" branching (contracts/shell-component-contract.md) — this is
the constraint that actually delivers "one shared visual language" rather than two shells that merely
look similar today and drift apart tomorrow.

**Scale/Scope**: 4 new `packages/ui` components (`AppShell`, `Card`, `Badge`, `PageHeader`), 1 amended
CSS class (`.surface-card`, shadow removed), a new topbar + always-expanded-grouped-sidebar CSS layer
replacing the current one-category-panel CSS, 2 rewritten dashboard layouts (tenant, platform) to
consume `AppShell` instead of their own bespoke sidebar components, and 2 existing files retrofitted
to use the new `Badge` component (provisioning success summary, permissions catalog) instead of
inline ad hoc pill spans.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Tenant Isolation**: PASS — N/A in the usual sense; this feature reads no tenant-scoped data
  itself. Converging the two shells does not blur isolation: `AppShell` only ever receives
  already-resolved, already-isolated values as props (spec Constitution Alignment).
- **II. Tenant Provisioning Includes Org Structure**: N/A — unrelated to provisioning logic; only the
  provisioning wizard's success-summary *tags* are retrofitted to the new `Badge` component
  (presentation only).
- **III. Forms/Flows Are Tenant-Configurable**: N/A — the shell structure and design tokens are fixed
  platform-wide by design (Principle V), not tenant-configurable (spec Constitution Alignment).
- **IV. Spec-Before-Code**: PASS — this plan follows an approved, clarified spec.
- **V. Design System Locked**: PASS — this spec *is* the design-system-establishing/refining work,
  performed via the UI-UX-Pro-Max skill during Phase 1 design below, superseding the ad hoc sidebar
  CSS from the Role-Based Dashboard Shell spec where they conflict (research.md §1, §5).
- **VI. Plan-Tier Aware**: N/A — shell chrome is baseline product infrastructure available to every
  tier, not a tier-gated capability.
- **VII. White-Labeling**: N/A — the tenant identity badge shows only the tenant's name (already
  resolved elsewhere), no logo/color white-labeling is introduced here.
- **VIII. Comprehensive-Version Rule**: N/A — the shell-convergence and accent-color questions were
  both explicitly resolved by the user during clarification, not silently narrowed by an agent.
- **IX. Demoable vs. Internal**: Demoable — restated from spec.md's Demo Flow.
- **X. New Branch, Clean Tree**: PASS — branch `008-desktop-shell-visual-language` created from a
  clean `master` (post Spec 7 merge).
- **XI. Stack Fixed**: PASS — Next.js frontend only, no backend change, no framework deviation.
- **XII/XIII. Dependency Discipline**: PASS — the one addition (`next` as a `packages/ui` peer
  dependency) triggers no install and mirrors the existing `react` peer dependency precedent
  (Technical Context, research.md §3).

No violations requiring Complexity Tracking (see below — empty).

## Project Structure

### Documentation (this feature)

```text
specs/008-desktop-shell-visual-language/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/
│   └── shell-component-contract.md
└── tasks.md              # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
packages/ui/src/
├── app-shell.tsx           # NEW: icon rail + always-expanded grouped sidebar + topbar + content slot
├── card.tsx                # NEW: rounded corners, hairline border, no shadow
├── badge.tsx                # NEW: pill-shaped status label, 4 variants
├── page-header.tsx          # NEW: title + subtitle pattern
└── index.ts                 # AMEND: export the 4 new components

apps/web/
├── app/
│   ├── globals.css                                  # AMEND: topbar/shell CSS, .surface-card shadow removed, badge CSS
│   ├── (dashboard-shell)/
│   │   ├── layout.tsx                                # AMEND: build nav config, render <AppShell>
│   │   └── dashboard-sidebar.tsx                      # DELETE: superseded by shared AppShell
│   ├── (platform-shell)/
│   │   ├── layout.tsx                                 # AMEND: build nav config, render <AppShell>
│   │   └── platform-sidebar.tsx                       # DELETE: superseded by shared AppShell
│   ├── (platform-shell)/provisioning/new/page.tsx     # AMEND: department tags use <Badge>
│   └── (platform-shell)/admin/permissions/page.tsx    # AMEND: category/permission-key tags use <Badge>
```

**Structure Decision**: Shared component work lives in `packages/ui` (the established cross-cutting
UI home); both dashboard layouts in `apps/web` are amended to consume it instead of maintaining their
own sidebar. No new top-level directories.

## Complexity Tracking

*No Constitution Check violations — table intentionally empty.*
