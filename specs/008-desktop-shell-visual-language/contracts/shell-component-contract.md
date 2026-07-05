# Contract: Shared Shell Components

Not an HTTP API — this feature's only "interface" is the shared UI component contract both
dashboards' layouts render against (data-model.md has the full prop tables). This document states
the behavioral contract each consumer can rely on.

## `AppShell`

- **Consumers**: `apps/web/app/(dashboard-shell)/layout.tsx`, `apps/web/app/(platform-shell)/layout.tsx`.
- Renders identically for both consumers given equivalent props — no internal branching on "which
  dashboard is this" (spec FR-002a, Clarifications). Any visual difference between the two dashboards
  must come entirely from the `railItems`/`navGroups`/`identity`/`breadcrumb` values each consumer
  passes in, never from `AppShell`'s own logic.
- Active-item detection: an item is active when `pathname === item.href` exactly — no partial/prefix
  matching, so a nav item never falsely shows active for an unrelated nested route (spec Edge Cases).
- Collapse/minimize: hides the expanded sidebar down to just the icon rail, state persisted via
  `localStorage` under a caller-namespaced key so the tenant and platform shells don't clobber each
  other's collapsed state in a browser that's authenticated as both in different tabs.
- Renders correctly with `children` being empty/placeholder content (spec FR-007) — `AppShell` itself
  never requires specific content shape from its children.

## `Card`

- Any content passed as `children` is wrapped with rounded corners, a hairline border, and consistent
  internal padding — no shadow (spec FR-008, FR-012).
- Existing usages of `.surface-card` (raw CSS class, not yet using this component) get the same
  flattened shadow-free treatment automatically once `.surface-card` itself is amended
  (data-model.md) — using the new `Card` component going forward is preferred for new code, but not
  required to retrofit those 3 existing files in this pass.

## `Badge`

- Four variants (`success`, `warning`, `neutral`, `accent`) are the only supported values — no
  arbitrary custom colors, keeping the "single accent, reserved for meaningful emphasis" rule (spec
  FR-009) from being bypassed one badge at a time.
