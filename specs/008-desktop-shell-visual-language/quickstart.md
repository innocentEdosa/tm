# Quickstart: Desktop Shell Visual Language

Prerequisites: `apps/api` and `apps/web` running (`pnpm dev` in each), a seeded Super Admin account,
and a tenant with at least one admin account (both already established in prior specs' quickstarts).

## Scenario 1 — Tenant dashboard shell

1. Log in as a tenant user at `/tenant`.
2. Expect: a single fixed-width sidebar on the far left — app mark + wordmark at top, a static
   workspace-label pill showing the tenant name, sectioned nav below it, and a bottom-pinned identity
   block (avatar initial, email, role) above a hairline border. No icon rail, no topbar — the content
   area starts directly with a page title + subtitle.
3. Confirm the current page's nav item shows a distinct active state (blue accent) versus every other
   item.
4. If a nav section contains an expandable group, confirm it defaults closed — even one containing
   the active page, in which case its one active child still peeks through beneath the (unhighlighted)
   toggle row. Clicking its chevron expands it to show every child, with the toggle row itself now
   showing the active-group highlight.

## Scenario 2 — Super Admin platform dashboard shell

1. Log in as a Super Admin at `/platform/login`.
2. Expect the identical sidebar structure and styling as Scenario 1 — only the nav items (Provision
   Tenant, Permissions) and the identity block (Super Admin's own name/email) differ. No
   workspace-label pill renders (no tenant concept at the platform level).
3. Confirm the sidebar's active-state, section dividers, and identity block match Scenario 1 exactly
   in spacing, colors, and typography.

## Scenario 3 — Card and badge patterns in isolation

1. Visit any page already using `.surface-card` (e.g. `/settings/team`) and confirm it now renders
   flat — hairline border, no drop shadow.
2. Visit the permissions catalog (`/admin/permissions`) and confirm the category/permission-key tags
   render as pill-shaped badges with a tinted background and matching darker text.
3. Visit the provisioning wizard's success screen (`/provisioning/new`, after completing a
   provisioning run) and confirm department tags use the same badge treatment.

## Verifying no functional regression

Since this feature only restyles/restructures existing, already-tested pages, re-run each dashboard's
existing task list quickstart scenarios (Role-Based Dashboard Shell spec's quickstart, Super Admin
Platform Dashboard spec's quickstart) to confirm every previously-working flow (Team Members,
Authentication Settings, Provision Tenant, Permissions) still works end-to-end through the new shell.
