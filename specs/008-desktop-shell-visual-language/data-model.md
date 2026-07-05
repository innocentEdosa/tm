# Data Model: Desktop Shell Visual Language

No new tables, columns, migrations, or API endpoints. This feature is purely presentational — it
reads no new backend data (spec Key Entities). This document instead captures the shared UI
component's own prop shape, since that's the closest thing this feature has to a "data model."

## `AppShell` props (`packages/ui/src/app-shell.tsx`)

| Prop | Type | Notes |
|---|---|---|
| `appMarkLabel` | `string` | Static app mark shown at the top of the icon rail — not per-user/per-tenant (spec Layout Structure: "app mark", distinct from the topbar's tenant identity badge). |
| `railItems` | `{ key: string; icon: IconType; label: string; href: string }[]` | Rendered on the icon rail, top to bottom. |
| `navGroups` | `{ key: string; label: string; collapsible?: boolean; items: NavItem[] }[]` | Rendered in the expanded sidebar, all groups visible simultaneously (research.md §1). |
| `identity` | `{ initial: string; name: string }` | Populates the topbar's identity badge only — the tenant's name (tenant dashboard) or the Super Admin's own name (platform dashboard). Static display, no click behavior (FR-005). |
| `breadcrumb` | `{ label: string; href?: string }[]` | Rendered left-aligned in the topbar. |
| `logoutHref` | `string` | `POST` target for logout, triggered from a dedicated icon-rail button — never the identity badge (FR-005 forbids making the badge itself interactive). |
| `afterLogoutHref` | `string` | Redirect target after logout succeeds. |
| `children` | `React.ReactNode` | The content slot — whatever page is currently rendering. |

`NavItem = { key: string; icon: IconType; label: string; href: string; disabled?: boolean }` —
`disabled` renders the "coming soon" treatment already established for the tenant sidebar's Courses
entry (Role-Based Dashboard Shell spec), reused here rather than redefined.

`icon` on `RailItem`/`NavItem` is an `IconName` string key (e.g. `"home"`, `"users"`), not a component
reference — Server Component layouts (`(dashboard-shell)/layout.tsx`, `(platform-shell)/layout.tsx`)
cannot pass function/component values to `AppShell` (a Client Component); React Server Component
serialization only allows plain data across that boundary (research.md §3, corrected during
implementation). `AppShell` resolves the name to an actual `lucide-react` icon via an internal
registry — `packages/ui` already depends on `lucide-react` for its own chrome icons, so this adds no
further dependency.

`AppShell` calls `usePathname()` (`next/navigation`) and renders nav items with `next/link`'s `Link`
internally — active-item detection and navigation are not prop-driven (research.md §3, revised).
`packages/ui/package.json` gains a `next` peerDependency alongside its existing `react` one.

## `Card` props (`packages/ui/src/card.tsx`)

| Prop | Type | Notes |
|---|---|---|
| `children` | `React.ReactNode` | Arbitrary grouped content. |
| `className` | `string` (optional) | Escape hatch for one-off spacing adjustments only — never for overriding the card's own border/radius/shadow rules. |

## `Badge` props (`packages/ui/src/badge.tsx`)

| Prop | Type | Notes |
|---|---|---|
| `variant` | `"success" \| "warning" \| "neutral" \| "accent"` | Selects the tinted background + matching darker text pairing (FR-013). |
| `children` | `React.ReactNode` | Badge label text. |

## `PageHeader` props (`packages/ui/src/page-header.tsx`)

| Prop | Type | Notes |
|---|---|---|
| `title` | `string` | Page title (FR-006). |
| `subtitle` | `string` (optional) | Short subtitle line under the title. |

## Amended existing CSS (no new competing classes — research.md §5)

- `.surface-card` (`apps/web/app/globals.css`): `box-shadow` removed, rounded corners + hairline
  border retained. Affects 3 existing consumers automatically (tenant Team Members, tenant
  Authentication Settings, Super Admin platform home) — no consumer code changes needed, only the
  shared class definition.
