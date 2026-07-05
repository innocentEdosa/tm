# Research: Desktop Shell Visual Language

## 1. Interaction model change: always-visible grouped sidebar, not one-category-at-a-time

**Decision**: Replace today's mechanism (click a rail icon to toggle open exactly one category's
panel; only one category's items visible at a time) with an always-expanded sidebar showing every
nav group simultaneously, each group independently collapsible via its own chevron (default
expanded).

**Rationale**: The spec's Layout Structure describes a fixed rail (simple, always-present icon
links) plus a separately fixed expanded sidebar containing multiple labeled groups ("Menu",
"Account") — this is a different shape from the current single-active-category toggle built for
Specs 6/7. The reference screenshot confirms this: "Top Instructor" and "Top Courses" both render
with their own independent collapse chevrons, simultaneously, not gated behind a rail-icon click.

**Alternatives considered**: Keeping today's one-category toggle and just re-labeling it was
rejected — it cannot satisfy "grouped nav sections... each item as an icon + text row" for more than
one group at a time, which both dashboards will need almost immediately (e.g. tenant: a "Menu" group
for Home/Courses, an "Account" group for Team Members/Authentication Settings).

## 2. One shared, framework-light `AppShell` component in `packages/ui`

**Decision**: Build `AppShell` (plus `Card`, `Badge`, `PageHeader`) in `packages/ui/src/`, imported by
both `apps/web/app/(dashboard-shell)/layout.tsx` and `apps/web/app/(platform-shell)/layout.tsx`
(Clarifications — both shells converge).

**Rationale**: `packages/ui` is already the shared component home (`Button`, `Input`, `Toggle`) for
exactly this reason — one canonical implementation both apps' layouts render, eliminating the
duplicated sidebar code the Super Admin Platform Dashboard spec's research explicitly accepted as a
tradeoff at the time (that decision is now superseded per Clarifications).

**Alternatives considered**: A shared component living directly in `apps/web` (e.g.
`apps/web/components/app-shell.tsx`) was considered — rejected only because `packages/ui` is the
already-established convention for cross-cutting UI, and nothing about this component is
`apps/web`-specific.

## 3. `AppShell` uses `next/navigation`/`next/link` directly, via a `next` peer dependency

**Decision**: `AppShell` is a Client Component that calls `usePathname()` itself and renders
navigation with Next's `Link`, rather than receiving `pathname` as a prop. `packages/ui/package.json`
gains a `next` peerDependency, matching its existing `react` peerDependency.

**Rationale**: `AppShell`'s consumers (`(dashboard-shell)/layout.tsx`, `(platform-shell)/layout.tsx`)
are Server Components — a Server Component cannot call `usePathname()` (client-only hook) to pass it
down as a prop, so the original "caller supplies pathname" design (this section, earlier draft) is
unworkable as stated: there is no valid place *outside* `packages/ui` for that hook call to live
without adding an extra thin client wrapper file per consumer. Since `AppShell` already must be a
Client Component for its own interactivity (collapse state, click handlers), calling `usePathname()`
inside it directly is simpler than threading an extra wrapper through both dashboards. A peer
dependency (like the existing `react` one) declares an expectation the consumer already satisfies —
it triggers no install and adds no real new dependency, since `apps/web` already has `next` at the
workspace root.

**Alternatives considered**: A per-dashboard thin Client Component wrapper (`apps/web`-side) that
calls `usePathname()` and passes it into `AppShell` as a plain prop was considered — this would have
kept `packages/ui` fully framework-agnostic, but adds a redundant file per consumer for a monorepo
where `packages/ui` is never published or consumed outside this Next.js app; not worth the extra
indirection.

**Correction during implementation (round 1)**: `AppShell`'s own fixed chrome (collapse chevrons,
group-expand chevron, search/notification/logout icons) isn't caller-configurable at all — forcing 6
more icon props onto every consumer just to avoid one import added real complexity for zero benefit.
`packages/ui` therefore gains a genuine (non-peer) `lucide-react` dependency, matching the version
already installed in `apps/web` (`^1.23.0`) — no new download, only a lockfile update.

**Correction during implementation (round 2)**: The original plan still had nav-item icons
(`railItems`/`navGroups`) passed as already-imported component references from each dashboard's
Server Component layout. That fails at runtime: `(dashboard-shell)/layout.tsx` and
`(platform-shell)/layout.tsx` are Server Components, and React Server Component serialization only
allows plain data across the Server→Client prop boundary — a component/function reference (e.g.
`lucide-react`'s `Home`) throws `Functions cannot be passed directly to Client Components`. Fixed by
having `RailItem`/`NavItem.icon` carry a plain string key (`IconName`, e.g. `"home"`) instead;
`AppShell` resolves it to the real icon via a small internal registry, using the `lucide-react`
dependency it already has from the round-1 correction above. Every icon name either dashboard's nav
config references must be added to this registry.

## 4. Logout stays a plain string prop, not a function prop

**Decision**: `AppShell` accepts `logoutHref: string` (the exact same-origin proxy URL to `POST`,
e.g. `/tenant-api/tenant-auth/logout?subdomain=...` or `/platform-api/platform/logout`) and
`afterLogoutHref: string` (where to redirect after) — it performs the `fetch` + redirect internally,
rather than accepting an `onLogout` callback function.

**Rationale**: `AppShell`'s callers (`(dashboard-shell)/layout.tsx`, `(platform-shell)/layout.tsx`)
are Server Components; a Server Component cannot pass a function prop across to a Client Component
(`AppShell` must be a Client Component for interactivity) without a Server Action, which is more
machinery than this needs. Two plain, serializable strings avoid the problem entirely, and each
dashboard's actual logout endpoint shape is already known statically at the call site.

## 5. Retroactively flattening `.surface-card` — no new competing card class

**Decision**: Amend the existing `.surface-card` CSS class (used today by 3 files: tenant Team
Members, tenant Authentication Settings, and the Super Admin platform home page) to remove its
`box-shadow`, keeping only the rounded corners + hairline border — rather than introducing a second,
competing "flat card" class.

**Rationale**: The spec requires "no drop shadows except functional focus states," and Principle V's
whole point is that a locked design system change propagates to every existing screen, not just new
ones. `.surface-card`'s shape (rounded corners, hairline border, internal padding) already matches
this spec's card requirement (FR-012) almost exactly — only the shadow needs to go. Introducing a
second "correct" card class alongside the old shadowed one would immediately create the exact
inconsistency this spec exists to prevent.

**Alternatives considered**: A brand-new `.card` class, deprecating `.surface-card` gradually, was
rejected as unnecessary churn — amending in place is a one-line CSS change with an immediate,
automatic fix across all 3 existing usages.

## 6. New `Badge` component consolidates existing ad hoc pill patterns

**Decision**: Introduce one `Badge` component (`packages/ui/src/badge.tsx`) with a `variant` prop
(`success | warning | neutral | accent`), rendering a small pill (rounded-full, tinted background,
matching darker text) — and replace the currently-scattered inline
`bg-cta/10 text-cta rounded-full px-2 py-0.5`-style spans (provisioning success summary's department
tags, the permissions catalog's category/permission-key tags) with `<Badge variant="accent">`.

**Rationale**: These inline patterns already visually satisfy "pill shape, tinted background, matching
darker text" — they just aren't a named, reusable, documented pattern yet (FR-013, FR-014). This is
squarely what the spec asks to be established now, before the next feature (e.g. real team-roster
invite statuses) reinvents its own version.

**Alternatives considered**: Leaving the existing ad hoc spans alone and only defining `Badge` for
*future* use was rejected — Principle V requires retroactive consistency once a pattern is locked, not
just forward-only adoption, and these 2 files are cheap to update in the same pass.

## 7. Topbar is entirely new — no prior art to reconcile

**Decision**: Build the topbar (`AppShell`'s top region: breadcrumb left, utility icons right, tenant/
identity badge far right) as new UI with no existing equivalent to migrate from.

**Rationale**: Neither shell has a topbar today (confirmed: `(dashboard-shell)/layout.tsx` and
`(platform-shell)/layout.tsx` both render only a sidebar + `<main>`, no top region). The breadcrumb's
content (page path) and the identity badge's content (tenant name / Super Admin identity) are supplied
by each dashboard's own layout, matching the same "caller resolves data, `AppShell` renders it" split
used everywhere else in this component (research.md §3–4). Search and notification icons follow the
same "visually present but stubbed" precedent already established for SSO login buttons (Tenant
Authentication Configuration spec) — clicking shows a small inline "not available yet" notice, never
a dead unresponsive control or a broken action.
