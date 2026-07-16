# Implementation Plan: Split-Screen Change Password Layout

**Branch**: `018-fix-change-password-ui` | **Date**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/018-fix-change-password-ui/spec.md`

## Summary

Restructure the mandatory `/set-password` page's presentation into a two-column split-screen layout —
the mirror of `017-fix-login-ui`'s tenant login split: a narrower credentials-form column on the LEFT
(workspace wordmark, the existing reassurance banner, heading, password fields, and submit button) and
a wide, purely decorative visual panel on the RIGHT reusing `017`'s existing CSS/SVG glow-and-shape
treatment. Unlike the reference screenshot, the panel carries no back-navigation control and no
quote/testimonial card (spec FR-009, FR-010 — resolved: both omitted to avoid a dead-end "back" action
on a mandatory step and to avoid a fabricated-customer-testimonial look). Below the tablet breakpoint,
the panel is hidden and the form reverts to today's full-width centered presentation. No backend,
routing, or password-change logic changes — this is a presentation-only restructure of
`apps/web/app/set-password/page.tsx` and `apps/web/app/set-password/set-password-form.tsx`, reusing the
project's already-locked design system and `017-fix-login-ui`'s existing layout CSS.

## Technical Context

**Language/Version**: TypeScript, Node.js (matches `apps/web`, unchanged)

**Primary Dependencies**: Next.js 15 (App Router, `apps/web`), React 19 — all existing, no additions.

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. The visual
panel reuses `017-fix-login-ui`'s existing plain-CSS/inline-SVG decorative treatment; no illustration
library, no image asset.

**Storage**: N/A — no schema change, no new query. The one new piece of data this feature reads is the
tenant's display name from the `x-tenant-name` request header, which `apps/web/middleware.ts` already
sets on every tenant request and which `(dashboard-shell)/layout.tsx` already reads the same way
(`headerList.get("x-tenant-name") ?? subdomain`) — no new fetch, no new endpoint.

**Testing**: No test runner exists in `apps/web` (unchanged decision carried since Spec 4/Spec 8,
reaffirmed by `017-fix-login-ui`). Verified via `quickstart.md`'s manual/browser scenarios, exercising
the existing set-password flow (success, mismatched passwords, server-rejected password) through the
new layout to confirm zero functional regression.

**Target Platform**: Web (unchanged).

**Project Type**: Web application — all changed code lives in `apps/web/app/set-password/`.

**Performance Goals**: No feature-specific target — a rendering/layout change plus one additional
header read (no network round-trip), no new client-side data fetching.

**Constraints**: The visual panel MUST use only existing design-system tokens (`--color-primary`,
`--color-cta`) and MUST reuse `017-fix-login-ui`'s existing `.login-brand-panel` /
`.login-brand-panel-glow` / `.login-brand-shape` CSS as-is (spec FR-006). The panel MUST NOT render a
back-navigation control or a quote/testimonial card (spec FR-009, FR-010).

**Scale/Scope**: 2 files amended (`apps/web/app/set-password/page.tsx`,
`apps/web/app/set-password/set-password-form.tsx`), one new prop (`tenantName`) threaded through, zero
new CSS classes, zero new `packages/ui` components.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Tenant Isolation**: N/A — no data access changes; the one new data point read (`x-tenant-name`)
  is a header middleware already resolves and scopes per-tenant, reused as-is (spec Constitution
  Alignment).
- **II. Tenant Provisioning Includes Org Structure**: N/A — unrelated to provisioning/org structure.
- **III. Forms/Flows Are Tenant-Configurable**: N/A — the password-change form's fields/logic are
  explicitly frozen by this spec (FR-004); only the surrounding layout changes, and that layout is
  fixed platform-wide by design (Principle V), not tenant-configurable.
- **IV. Spec-Before-Code**: PASS — this plan follows the approved spec at
  `specs/018-fix-change-password-ui/spec.md`, including its resolved clarifications (FR-009, FR-010).
- **V. Design System Locked**: PASS — reuses the existing locked tokens/typography in
  `apps/web/app/globals.css` and the layout CSS `017-fix-login-ui` already added, with no new palette,
  font, or CSS class introduced (spec FR-006, SC-004).
- **VI. Plan-Tier Aware**: N/A — the change-password screen is baseline product infrastructure available
  to every tier, not a tier-gated capability.
- **VII. White-Labeling**: PASS/N/A — the form column shows the tenant's own name via the same
  `x-tenant-name` header/fallback pattern `(dashboard-shell)/layout.tsx` already uses. No per-tenant
  logo/color config exists yet in the product, so none is introduced here.
- **VIII. Comprehensive-Version Rule**: N/A — no conflicting scope between source docs; the spec
  explicitly narrows scope to one page and states that narrowing plainly (spec FR-008), and the two
  ambiguous reference-screenshot elements (back control, quote card) were resolved via clarification
  rather than silently picked.
- **IX. Demoable vs. Internal**: PASS — restated from spec.md: demoable, a visible stakeholder-facing
  change.
- **X. New Branch, Clean Tree**: PASS — work proceeds on branch `018-fix-change-password-ui`.
- **XI. Stack Fixed**: PASS — Next.js frontend only, no backend change, no framework deviation.
- **XII/XIII. Dependency Discipline**: PASS — no new dependency (Technical Context above).

No violations requiring Complexity Tracking (see below — empty).

## Project Structure

### Documentation (this feature)

```text
specs/018-fix-change-password-ui/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── set-password-layout-contract.md
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
apps/web/app/set-password/
├── page.tsx                 # AMEND: read the existing `x-tenant-name` header (same pattern as
│                             #   (dashboard-shell)/layout.tsx) and pass it as a new `tenantName` prop;
│                             #   session/redirect logic unchanged
└── set-password-form.tsx    # AMEND: add `tenantName` prop; wrap existing form markup (reassurance
                              #   banner, heading, error banner, fields, submit button) in the new
                              #   two-column layout (form column left, decorative visual panel right);
                              #   zero changes to state, handlers, or submit/validation logic

apps/web/app/globals.css      # AMEND (comment only): update the existing "Tenant login split-screen"
                               #   comment block above `.login-split`/`.login-brand-panel`/
                               #   `.login-brand-panel-glow`/`.login-brand-shape`/`.login-form-column`
                               #   to note these classes are now shared by two pages. No new class, no
                               #   changed rule, no new token — `apps/web/app/tenant/tenant-login-form.tsx`
                               #   is untouched (spec FR-008).
```

**Structure Decision**: All functional changes are contained inside `apps/web/app/set-password/` (the
one page this feature touches, per spec FR-008), reusing the split-screen CSS `017-fix-login-ui` already
added to `apps/web/app/globals.css` verbatim — only its descriptive comment is updated. No new
`packages/ui` component: as with `017-fix-login-ui`, this split-screen composition has exactly one
consumer per page and does not meet the bar for a shared component.

## Complexity Tracking

*No Constitution Check violations — table intentionally empty.*
