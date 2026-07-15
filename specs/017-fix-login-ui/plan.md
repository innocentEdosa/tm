# Implementation Plan: Split-Screen Tenant Login Layout

**Branch**: `017-fix-login-ui` | **Date**: 2026-07-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/017-fix-login-ui/spec.md`

## Summary

Restructure the tenant login page's presentation into a two-column split-screen layout: a wide brand
panel on the left (workspace name, a value-proposition headline, a supporting sentence, and an
original CSS/SVG decorative graphic) and the existing, functionally-unchanged login form in a
narrower column on the right. Below the tablet breakpoint, the brand panel is hidden and the form
column reverts to today's full-width centered presentation. No backend, routing, or auth-logic
changes — this is a presentation-only restructure of `apps/web/app/tenant/page.tsx` and
`apps/web/app/tenant/tenant-login-form.tsx`, reusing the project's already-locked design system.

## Technical Context

**Language/Version**: TypeScript, Node.js (matches `apps/web`, unchanged)

**Primary Dependencies**: Next.js 15 (App Router, `apps/web`), React 19 — all existing, no additions.

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. The
decorative brand-panel graphic is built with plain CSS/inline SVG, no illustration library.

**Storage**: N/A — no schema change, no new query. Reuses the same `tenantName`/`subdomain`/
`enabledAuthMethods` data the page already fetches (spec Key Entities).

**Testing**: No test runner exists in `apps/web` (unchanged decision carried since Spec 4/Spec 8).
Verified via `quickstart.md`'s manual/browser scenarios, exercising every existing auth path (success,
invalid credentials, no-method-configured, SSO placeholder) through the new layout to confirm zero
functional regression.

**Target Platform**: Web (unchanged).

**Project Type**: Web application — all new/changed code lives in `apps/web/app/tenant/`.

**Performance Goals**: No feature-specific target — a rendering/layout change only, no new network
calls, no new client-side data fetching.

**Constraints**: Brand panel MUST use only existing design-system tokens (`--color-primary`,
`--color-cta`, `--color-surface`, `--color-border`) and MUST render as pure CSS/SVG (no image assets)
so it degrades gracefully and adds no load-time dependency (spec Edge Cases, FR-006).

**Scale/Scope**: 1 page restructured (`apps/web/app/tenant/tenant-login-form.tsx`), its parent
(`apps/web/app/tenant/page.tsx`) unchanged apart from possibly wrapping markup, 1 new responsive
two-column layout pattern, 1 new decorative-graphic treatment. No new `packages/ui` components
required — the split-screen wrapper is specific to this one page, not a reusable shell pattern.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Tenant Isolation**: N/A — no data access changes; reuses already-tenant-scoped props the page
  already receives server-side (spec Constitution Alignment).
- **II. Tenant Provisioning Includes Org Structure**: N/A — unrelated to provisioning/org structure.
- **III. Forms/Flows Are Tenant-Configurable**: N/A — the login form's fields/logic are explicitly
  frozen by this spec (FR-004); only the surrounding layout changes, and that layout is fixed
  platform-wide by design (Principle V), not tenant-configurable.
- **IV. Spec-Before-Code**: PASS — this plan follows the approved spec at `specs/017-fix-login-ui/spec.md`.
- **V. Design System Locked**: PASS — reuses the existing locked tokens/typography in
  `apps/web/app/globals.css` (`--color-primary`, `--color-cta`, `--color-surface`, `--color-border`,
  Plus Jakarta Sans) with no new palette or font introduced (spec FR-006, SC-004).
- **VI. Plan-Tier Aware**: N/A — the login screen is baseline product infrastructure available to every
  tier, not a tier-gated capability.
- **VII. White-Labeling**: PASS/N/A — the brand panel shows the tenant's own name, the only per-tenant
  identity signal already available (matching dashboard-shell precedent, spec Assumptions). No
  per-tenant logo/color config exists yet in the product, so none is introduced here; the panel's
  visual chrome intentionally uses the one shared platform design system, same as the rest of the
  tenant-facing shell.
- **VIII. Comprehensive-Version Rule**: N/A — no conflicting scope between source docs; the spec
  explicitly narrows scope to one page and states that narrowing plainly (spec FR-009).
- **IX. Demoable vs. Internal**: PASS — restated from spec.md: demoable, a visible stakeholder-facing
  change.
- **X. New Branch, Clean Tree**: PASS — work proceeds on branch `017-fix-login-ui`.
- **XI. Stack Fixed**: PASS — Next.js frontend only, no backend change, no framework deviation.
- **XII/XIII. Dependency Discipline**: PASS — no new dependency (Technical Context above).

No violations requiring Complexity Tracking (see below — empty).

## Project Structure

### Documentation (this feature)

```text
specs/017-fix-login-ui/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/
│   └── tenant-login-layout-contract.md
└── tasks.md              # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
apps/web/app/tenant/
├── page.tsx                 # UNCHANGED logic; passes the same props to TenantLoginForm
└── tenant-login-form.tsx    # AMEND: wrap existing form markup in the new two-column layout;
                              #   add the brand panel (left column) and responsive collapse behavior;
                              #   zero changes to state, handlers, fields, or conditional rendering
                              #   logic already present

apps/web/app/globals.css      # AMEND: add layout/utility classes for the split-screen wrapper and
                               #   brand panel (new CSS only, reusing existing --color-* tokens —
                               #   no new tokens added)
```

**Structure Decision**: All changes are contained inside `apps/web/app/tenant/` (the one page this
feature touches, per spec FR-009) plus supporting CSS additions to the existing
`apps/web/app/globals.css` design-system file. No new `packages/ui` component — the split-screen
wrapper is a one-off page composition, not a cross-cutting shell pattern reused elsewhere today (unlike
`AppShell` in Spec 8, which multiple dashboards share).

## Complexity Tracking

*No Constitution Check violations — table intentionally empty.*
