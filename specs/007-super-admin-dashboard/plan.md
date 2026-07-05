# Implementation Plan: Super Admin Platform Dashboard Shell

**Branch**: `007-super-admin-dashboard` | **Date**: 2026-07-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-super-admin-dashboard/spec.md`

## Summary

Give the platform Super Admin's existing capabilities (identity summary, tenant provisioning,
permission/role-template catalog) a persistent, discoverable shell — the same two-tier icon-rail +
category-panel pattern just established for tenant users, adapted for a flat, ungated platform role.
Purely a frontend restructuring: a new route group wraps three existing, unmodified pages behind one
new layout and sidebar; a new shared session helper mirrors the tenant-side one. Zero backend changes
— every endpoint this shell surfaces already exists and already returns everything needed
(research.md §1).

## Technical Context

**Language/Version**: TypeScript, Node.js (matches `apps/web`, unchanged)

**Primary Dependencies**: Next.js 15 (App Router), `@tm/ui` (`Button`, `Input`, existing) — all
already installed.

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None.

**Storage**: PostgreSQL (existing) — no schema change, no new query even; every endpoint this shell
consumes already exists and is unmodified (research.md §1, data-model.md).

**Testing**: No `apps/api` changes means no new backend tests are needed. No test runner exists in
`apps/web` (unchanged decision carried from Spec 4 research.md §6, restated in every subsequent
frontend-touching spec). Verified via `quickstart.md`'s manual/browser scenarios instead.

**Target Platform**: Web (unchanged deployment target — root domain, not a tenant subdomain).

**Project Type**: Web application (existing `apps/web` frontend; `apps/api` untouched by this spec).

**Performance Goals**: No feature-specific target — this adds one additional server-to-server
`/platform/me` call per shell page load, matching the existing cost `app/platform/page.tsx` already
incurs client-side today (moved to a server-side Server Component call instead, mirroring the tenant
shell's `tenant-session.ts` pattern).

**Constraints**: Must not introduce any tenant_id-scoped data path — this shell is platform-level
only (FR-007). No RLS concern: nothing here queries a tenant-scoped table directly.

**Scale/Scope**: One new route group (`app/(platform-shell)/`) wrapping 3 existing pages (moved, not
rewritten in logic), 1 new layout, 1 new sidebar component, 1 new shared session helper. Zero new
backend routes, zero migrations, zero new dependencies.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Tenant Isolation**: PASS — N/A in the usual sense; this feature touches no tenant-scoped data
  path at all (FR-007). The one place tenant data is *created* (provisioning) goes through its
  existing, unmodified, already-isolated endpoint.
- **II. Tenant Provisioning Includes Org Structure**: PASS — unchanged; this feature only relocates/
  restyles the wizard, not its behavior.
- **III. Forms/Flows Are Tenant-Configurable**: N/A — this is platform-internal operator tooling, not
  a tenant-facing or tenant-configurable surface (stated in spec.md's Constitution Alignment).
- **IV. Spec-Before-Code**: PASS — this plan follows an approved spec with no open clarifications.
- **V. Design System Locked**: PASS. Reuses `design-system/tm/MASTER.md` and the exact `sidebar-*` CSS
  classes already added to `globals.css` by the Role-Based Dashboard Shell spec — zero new classes,
  zero new palette/typography choices.
- **VI. Plan-Tier Aware**: N/A by design — platform Super Admin tooling has no tenant plan tier at
  all; tier gating applies to tenant-facing features, not internal operator chrome.
- **VII. White-Labeling**: N/A — no tenant branding is touched; this is internal platform chrome
  (Principle V's distinction from tenant white-labeling).
- **VIII. Comprehensive-Version Rule**: N/A — no scope ambiguity was narrowed here; the spec was
  explicit about "no new capability" from the start.
- **IX. Demoable vs. Internal**: Demoable — restated from spec.md's Demo Flow.
- **X. New Branch, Clean Tree**: PASS — branch `007-super-admin-dashboard` created from clean
  `master` (post Spec 6 merge), then `master` was merged back into it once Spec 6 landed, so this
  branch can reuse Spec 6's sidebar CSS/pattern as intended.
- **XI. Stack Fixed**: PASS — Next.js frontend only, no backend change, no framework deviation.
- **XII/XIII. Dependency Discipline**: PASS — no new dependency (Technical Context).

No violations requiring Complexity Tracking (see below — empty).

## Project Structure

### Documentation (this feature)

```text
specs/007-super-admin-dashboard/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── platform-me-reference.md
└── tasks.md              # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
apps/web/
├── lib/
│   └── platform-session.ts               # NEW: mirrors tenant-session.ts, platform-level (no subdomain)
└── app/
    ├── platform/
    │   └── login/page.tsx                 # UNCHANGED — stays outside the shell (mirrors /tenant login)
    └── (platform-shell)/                  # NEW route group — no URL segment of its own
        ├── layout.tsx                     # NEW: session check + sidebar frame
        ├── platform-sidebar.tsx           # NEW: two-tier icon rail + panel, ungated (research.md §5)
        ├── platform/
        │   └── page.tsx                   # MOVED + restyled (was app/platform/page.tsx) — identity summary
        ├── provisioning/
        │   └── new/
        │       └── page.tsx               # MOVED + restyled (was app/provisioning/new/page.tsx) — logic unchanged
        └── admin/
            └── permissions/
                └── page.tsx               # MOVED + restyled (was app/admin/permissions/page.tsx) — logic unchanged
```

**Structure Decision**: Mirrors `app/(dashboard-shell)/` exactly (Role-Based Dashboard Shell spec) —
a route group so existing URLs (`/platform`, `/provisioning/new`, `/admin/permissions`) don't change,
just gain a shared persistent layout. No new top-level directories beyond the route group and its
nested (also-existing) paths.

## Complexity Tracking

*No Constitution Check violations — table intentionally empty.*
