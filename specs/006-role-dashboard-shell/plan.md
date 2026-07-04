# Implementation Plan: Role-Based Dashboard Shell

**Branch**: `006-role-dashboard-shell` | **Date**: 2026-07-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-role-dashboard-shell/spec.md`

## Summary

Build the persistent navigation shell every user lands on immediately after login (a Next.js layout
with a role-aware sidebar, wrapping a shared "more to come" placeholder content area) and route login
directly there instead of Spec 5's bespoke "You're signed in" confirmation page. The sidebar's entries
are derived from the logged-in user's actual permissions (Spec 1), reusing the existing
`GET /tenant-auth/me` endpoint amended to also return `roleName` and `permissions`. No new tables,
migrations, or dependencies — this is entirely reuse of existing auth/permission infrastructure behind
one new frontend route (`/dashboard`) and one backend response amendment.

## Technical Context

**Language/Version**: TypeScript, Node.js (matches `apps/api`/`apps/web` engines, unchanged)

**Primary Dependencies**: Next.js 15 (App Router, `apps/web`), Fastify (`apps/api`), Drizzle ORM — all
already installed; `@tm/ui` (`Button`, existing) for consistency with the locked design system

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. No icon
library is added — sidebar icons are inline SVG (matching the existing no-emoji-icons UI-UX-Pro-Max
guideline) authored by hand for the small, fixed set of entries (Home, Team, Authentication, Courses),
which Node/Next.js/React already fully support with zero new packages.

**Storage**: PostgreSQL (existing) — no schema change; reads existing `users`/`roles`/`user_roles`/
`role_permissions`/`permissions` tables only (data-model.md).

**Testing**: Vitest + real Postgres for the `apps/api` amendment (matching Specs 3–5's precedent — no
mocks). No test runner exists in `apps/web` (unchanged decision carried from Spec 4 research.md §6);
the new frontend route is verified via `quickstart.md`'s manual/browser scenarios instead.

**Target Platform**: Web (Next.js on Vercel + Fastify on existing hosting, unchanged deployment target)

**Project Type**: Web application (existing `apps/api` + `apps/web` monorepo structure, unchanged)

**Performance Goals**: No feature-specific target beyond standard web app expectations — this is a
single additional server-to-server auth check per shell page load, no different in cost from the
existing `/tenant-auth/me` calls Spec 5 already makes on `/tenant` and `/set-password`.

**Constraints**: Must not introduce a new RLS policy (data-model.md confirms none needed — existing
`tenant_isolation` policies on `user_roles`/`role_permissions`/`permissions` already scope every row
read here to the caller's own tenant).

**Scale/Scope**: One new frontend route (`app/dashboard/layout.tsx` + `page.tsx`), one new shared
frontend helper (`lib/tenant-session.ts`), amendments to three existing frontend files (redirect
targets), one amended backend endpoint response shape, zero new backend routes, zero migrations.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Tenant Isolation**: PASS. All new reads (role name, permissions) go through `request.tenantDb`,
  already RLS-scoped (data-model.md). No client-supplied tenant/user identifier is ever trusted — the
  session's own `request.user.id`/`tenantId` (Spec 5's session mechanism) is the sole source.
- **II. Tenant Provisioning Includes Org Structure**: N/A — no provisioning change.
- **III. Forms/Flows Are Tenant-Configurable**: The shell's navigation *structure* (which entries exist
  at all, and which permission gates each one) is intentionally fixed platform-wide, not
  tenant-configurable — stated in spec.md's Constitution Alignment with reasoning (every tenant's users
  get the same sidebar mechanism; only *visibility per user* varies, driven by each tenant's own
  existing per-tenant role/permission configuration from Spec 1). This mirrors how Spec 5's SSO method
  list is fixed (four known methods) while *which are enabled* is tenant-configurable.
- **IV. Spec-Before-Code**: PASS — this plan follows an approved, clarified spec.
- **V. Design System Locked**: PASS. Reuses `design-system/tm/MASTER.md` (navy/blue palette, Plus
  Jakarta Sans, existing `@tm/ui` `Button`) — no new palette, font, or component style introduced. The
  reference screenshot supplied with the spec informs the sidebar's *visual language* only (icon+label
  rows, active-state highlighting), not a new design system.
- **VI. Plan-Tier Aware**: N/A by design, stated explicitly — the dashboard shell (navigation
  infrastructure) is baseline product chrome available to every tier, not a Growth/Enterprise-gated
  capability like AI course generation or full Kirkpatrick reporting. No tier-flag check is introduced
  or needed here.
- **VII. White-Labeling**: N/A — no tenant branding (logo/colors/subdomain) is touched by this feature;
  it uses the platform's own internal design system, a distinct concern from tenant white-labeling
  (Principle V's own parenthetical).
- **VIII. Comprehensive-Version Rule**: N/A as a violation risk — the narrower scope (shell only, no
  per-role content) was an explicit stakeholder instruction after reviewing the fuller draft spec, not
  a silent default to the smaller option. Recorded in spec.md's Clarifications for traceability.
- **IX. Demoable vs. Internal**: Demoable — restated from spec.md's Demo Flow.
- **X. New Branch, Clean Tree**: PASS — branch `006-role-dashboard-shell` created from a clean `master`
  (post Spec 5 merge) before any spec work began.
- **XI. Stack Fixed**: PASS — Next.js frontend, Fastify backend, no deviation proposed.
- **XII/XIII. Dependency Discipline**: PASS — no new dependency; see Technical Context.

No violations requiring Complexity Tracking (see below — empty).

## Project Structure

### Documentation (this feature)

```text
specs/006-role-dashboard-shell/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/
│   └── tenant-auth-me-amendment.md
└── tasks.md              # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
apps/api/
└── src/
    └── tenant-auth/
        └── tenant-auth-routes.ts        # AMEND: GET /tenant-auth/me gains roleName + permissions

apps/web/
├── lib/
│   └── tenant-session.ts                # NEW: shared server-side session-fetch helper
└── app/
    ├── tenant/
    │   ├── page.tsx                     # AMEND: use tenant-session.ts; redirect to /dashboard when already authenticated
    │   ├── tenant-login-form.tsx        # AMEND: redirect target /tenant -> /dashboard on success
    │   └── tenant-authenticated-view.tsx # DELETE: superseded by /dashboard
    ├── set-password/
    │   ├── page.tsx                     # AMEND: use tenant-session.ts
    │   └── set-password-form.tsx        # AMEND: redirect target /tenant -> /dashboard on success
    └── dashboard/
        ├── layout.tsx                    # NEW: Server Component — session/role/permission fetch, sidebar frame
        ├── dashboard-sidebar.tsx         # NEW: Client Component — renders nav entries, handles "coming soon" click
        └── page.tsx                      # NEW: shared "more to come" empty-state content
```

**Structure Decision**: Existing monorepo layout (`apps/api` Fastify backend, `apps/web` Next.js
frontend) — unchanged. New work is additive within `apps/web/app/dashboard/`, one new shared helper in
`apps/web/lib/`, and a response-shape amendment to one existing `apps/api` route file. No new
top-level directories.

## Complexity Tracking

*No Constitution Check violations — table intentionally empty.*
