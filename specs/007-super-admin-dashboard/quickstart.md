# Quickstart: Super Admin Platform Dashboard Shell

Prerequisites: `apps/api` running (`pnpm dev`), `apps/web` running (`pnpm dev`), a seeded Super Admin
account (`pnpm seed:super-admin` in `apps/api`, per the Super Admin Authentication spec's own
quickstart).

## Scenario 1 — Land directly on the platform dashboard shell

1. Log in at `http://tm.lvh.me:3000/platform/login` (or your configured root domain) with the seeded
   Super Admin credentials.
2. Expect: immediate redirect to `/platform` showing the persistent sidebar (Home, Platform Tools,
   collapse toggle, Log out) and the identity summary (name, email, last login) as the main content —
   no separate confirmation page shown first.

## Scenario 2 — Provision a tenant from the shell

1. From the shell, click "Platform Tools" on the rail — expect the panel opens showing "Provision
   Tenant" and "Permissions".
2. Click "Provision Tenant" — expect the existing 3-step wizard loads at `/provisioning/new`, inside
   the shell frame, restyled to the current design system, sidebar still visible with "Provision
   Tenant" highlighted active.
3. Complete all 3 steps with valid company/department/admin data and submit.
4. Expect: the same success summary (tenant ID, subdomain, status, admin, departments) as before this
   feature, just restyled.

## Scenario 3 — View the permissions catalog from the shell

1. From the shell, open "Platform Tools" → "Permissions".
2. Expect: the existing permission/role-template catalog loads at `/admin/permissions`, inside the
   shell frame, restyled, sidebar still visible with "Permissions" highlighted active, same data as
   before this feature.

## Scenario 4 — Collapse/minimize persistence

1. Click the collapse toggle at the bottom of the rail — expect the panel hides, leaving just the
   icon rail (mirrors the tenant shell's behavior exactly).
2. Reload the page — expect the sidebar stays collapsed (persisted via the same `localStorage`
   mechanism as the tenant shell).

## Verifying platform-level scope (no tenant_id)

Confirm none of the three pages in this shell ever reference or display a `tenant_id` except as an
*output* of successfully provisioning a new tenant (Scenario 2's success summary) — there is no
tenant-subdomain concept anywhere in this shell (FR-007).
