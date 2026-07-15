# Research: Split-Screen Tenant Login Layout

## 1. Responsive breakpoint for collapsing to single-column

**Decision**: Use Tailwind's `lg` breakpoint (1024px) as the cutover point. Below `lg`, the brand
panel is hidden (`hidden lg:flex`) and the form column becomes the page's only content, full-width and
centered exactly as today's markup already renders it.

**Rationale**: No prior split-screen/two-column pattern exists elsewhere in this codebase to follow as
precedent (grep for `hidden md:`/`hidden lg:`/`md:grid`/`lg:grid` across `apps/web` and `packages/ui`
returned nothing). `lg` is the conventional cutover for this exact "marketing panel + form" pattern
(matches the reference screenshot's own apparent behavior) — it keeps the two-column layout exclusive
to genuinely wide desktop viewports and avoids squeezing a brand panel onto tablet-width (768–1024px)
screens where it would crowd the form.

**Alternatives considered**: `md` (768px) was considered and rejected — a brand panel at tablet widths
would leave too little room for a comfortable form column, and the current single-column layout is
already perfectly usable at that width, so there is no reason to introduce the two-column layout that
early.

## 2. Where the split-screen wrapper lives

**Decision**: Add the two-column wrapper and brand panel directly inside
`apps/web/app/tenant/tenant-login-form.tsx`, replacing its current single `<main>` wrapper. The
existing JSX subtree for the form itself (heading, error banner, form fields, divider, SSO buttons,
no-method message) moves unchanged into the new right-hand column — no props, state, handlers, or
conditional logic are touched.

**Rationale**: `apps/web/app/tenant/page.tsx` already does the minimum necessary (fetch tenant data,
decide auth state, pass props) and has no reason to know about layout. Keeping the restructure
entirely inside the one Client Component that already owns the form's presentation avoids introducing
a new file or prop for a layout that is not reused anywhere else (unlike `AppShell` in Spec 8, which
two dashboards share) — a single-page split-screen wrapper does not meet the bar for a new
`packages/ui` component.

**Alternatives considered**: Extracting a `LoginSplitLayout` wrapper component (either in
`apps/web/app/tenant/` or `packages/ui`) was considered — rejected as premature abstraction for a
pattern with exactly one current consumer (spec FR-009 scopes this to the tenant login page only); can
be promoted to a shared component later if the platform login page (`apps/web/app/platform/login/`)
adopts the same layout in a future spec.

## 3. Decorative brand-panel graphic: CSS/SVG composition, not an image asset or fabricated dashboard mockup

**Decision**: Build the brand panel's lower-area visual as a plain composition of soft, blurred
gradient blobs (large circles, `--color-cta` at low opacity, `filter: blur(...)`) layered behind a
few simple rounded-rectangle "card" shapes (translucent white fills, hairline borders) loosely
arranged to suggest organized workspace content — no text, numbers, or chart lines that could read as
real product data.

**Rationale**: Spec FR-003 explicitly forbids depicting fabricated product data/screenshots/metrics
(the reference screenshot's CRM dashboard mockup is exactly what this must NOT copy). Pure CSS/inline
SVG needs no new image asset, no illustration library, and no network request, satisfying
Constitution Principles XII/XIII (no new dependency) and the spec's "must degrade gracefully" edge
case (Edge Cases: a CSS-only panel cannot fail to load the way an external image could).

**Alternatives considered**: Sourcing/generating a static illustration image was considered —
rejected because it would add a binary asset and a loading-failure edge case for no real benefit over
a CSS-only treatment, and risks drifting from the locked token palette over time (a designer swapping
the image later could silently introduce off-system colors).

## 4. Brand panel copy

**Decision**: Headline: "Empower Your Team to Learn, Grow, and Succeed." Supporting sentence: "Sign in
to build training, track employee progress, and grow your team's skills — all in one place."
Wordmark/name shown: the existing `tenantName` prop (already fetched by `page.tsx`), styled the same
way the dashboard-shell sidebar already displays it (`shell-sidebar-wordmark` precedent).

**Rationale**: FR-008 requires the panel's copy to describe this product's value rather than reusing
the reference's CRM-specific copy verbatim. Per the constitution's Project Identity, TM is specifically
an L&D/LMS platform for HR teams (training, course generation, Kirkpatrick evaluation) — not a
general-purpose workspace/CRM tool — so the copy names that domain directly (training, employee
progress, skills) rather than generic "workspace" language. Reusing `tenantName` for the panel's
identity marker keeps a single source of truth with the existing "Welcome to {tenantName}" heading
already in the form column, and matches the no-per-tenant-logo assumption already documented in
spec.md (Assumptions) — no new data fetched.

**Alternatives considered**: A generic, non-tenant-specific brand mark (e.g. a fixed "TM" wordmark
matching the Super Admin platform shell) was considered — rejected because the tenant dashboard shell
already personalizes identity with the tenant's own name once authenticated, and doing so before login
too is more welcoming and consistent with that established precedent.

## 5. Layout mechanism

**Decision**: A `flex` container (`flex min-h-screen`) with the brand panel as a `flex-1` (or
fixed-fraction, e.g. roughly matching the reference's ~55/45 split) child and the form column as the
second child with fixed comfortable content width, centered within its own column — not CSS Grid.

**Rationale**: The existing desktop shell (`.shell` class, `apps/web/app/globals.css`) already
establishes `flex min-h-screen` as this codebase's convention for full-height two-region layouts
(sidebar + content). Reusing the same mechanism keeps the two full-height split layouts in this
codebase (dashboard shell, login split-screen) consistent in approach even though they serve different
purposes.

**Alternatives considered**: CSS Grid (`grid grid-cols-[...]`) would work equally well but was passed
over only for consistency with the existing `.shell` flex convention already established in this file.
