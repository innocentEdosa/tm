# Research: Split-Screen Change Password Layout

## 1. Responsive breakpoint for collapsing to single-column

**Decision**: Reuse the same `lg` breakpoint (1024px) `017-fix-login-ui` established for the tenant
login split-screen. Below `lg`, the visual panel is hidden (`hidden lg:flex`, inherited from
`.login-brand-panel`) and the form column becomes the page's only content, full-width and centered
exactly as today's `/set-password` markup already renders it.

**Rationale**: Spec Assumptions explicitly calls for matching `017-fix-login-ui`'s breakpoint "for
visual consistency between the two related screens." Introducing a different cutover for this sibling
auth screen would create an inconsistent responsive feel between two pages a user may see back-to-back
in the same session (login → forced password change).

**Alternatives considered**: An independent breakpoint decision was considered and rejected — there is
no scope- or content-specific reason for `/set-password` to collapse at a different width than
`/tenant`.

## 2. Where the split-screen wrapper lives

**Decision**: Add the two-column wrapper and visual panel directly inside
`apps/web/app/set-password/set-password-form.tsx`, replacing its current single `<main>` wrapper. The
existing JSX subtree (reassurance banner, heading, error banner, form fields, submit button) moves
unchanged into the new left-hand column — no state, handlers, or conditional logic are touched. The one
addition is a new `tenantName` prop, rendered as a wordmark above the reassurance banner (spec FR-002).
`apps/web/app/set-password/page.tsx` is amended only to read the already-available `x-tenant-name`
header and pass it through.

**Rationale**: Mirrors `017-fix-login-ui`'s own decision (research.md §2 of that spec) — the page
component's job stays limited to session/redirect logic and prop-passing; the Client Component that
already owns the form's presentation is the natural, and only, owner of its own layout.

**Alternatives considered**: Extracting a shared `AuthSplitLayout` wrapper component (used by both
`tenant-login-form.tsx` and `set-password-form.tsx`) was considered — rejected as premature abstraction.
Spec FR-008 explicitly scopes this feature to the set-password page only and forbids touching the
tenant login page; retrofitting a shared component now would require editing
`tenant-login-form.tsx` too, outside this feature's approved scope. If a third auth screen later adopts
the same pattern, promoting the CSS treatment (already shared, see §3) to a shared component becomes a
reasonable follow-up.

## 3. Reusing `017-fix-login-ui`'s existing layout CSS vs. adding new classes

**Decision**: Reuse `.login-split`, `.login-brand-panel`, `.login-brand-panel-glow`, and
`.login-brand-shape` verbatim — no new CSS classes or tokens added to `globals.css`. Because this
feature puts the form on the LEFT and the panel on the RIGHT (the opposite arrangement from the tenant
login page), the mirroring is achieved purely through JSX order inside the existing `.login-split` flex
container (form column first, panel second) — the classes themselves are direction-agnostic and require
no modification. Only the descriptive CSS comment above these rules is updated to note they now serve
two pages.

**Rationale**: These are layout/utility classes, not part of the color/typography token set — reusing
them exactly satisfies spec FR-006 (no new colors/fonts) with the least surface area, and avoids
duplicating identical CSS under a second name. `.login-split` is a flex row; a flex row's DOM order
directly determines left-to-right visual order, so no "reverse" variant or new class is needed to mirror
the arrangement.

**Alternatives considered**: (a) Duplicating the rules under generically-named classes (e.g.
`.auth-split`, `.auth-visual-panel`) was considered for naming clarity, since a class literally named
`login-brand-panel` now also renders on the password-change page — rejected because it would either
duplicate identical CSS (adding maintenance surface for zero behavioral benefit) or require renaming the
original classes, which would touch `tenant-login-form.tsx` and violate spec FR-008's scope boundary.
(b) A `flex-row-reverse` modifier was considered to keep panel-then-form DOM order while flipping visual
position — rejected as unnecessary complexity; reordering the JSX directly is simpler and equally
correct.

## 4. Visual panel content: purely decorative, no headline or copy

**Decision**: The visual panel renders only the existing background + glow-blob + shape-composition
elements (`.login-brand-panel-glow`, `.login-brand-shape`) from `017-fix-login-ui` — no headline, no
supporting sentence, no wordmark, no card of any kind.

**Rationale**: Spec FR-002 already places the workspace wordmark/identity in the form column (left
side) for this feature, unlike the login page where it appears in the brand panel — so duplicating it
on the visual panel would be redundant. Spec FR-009 and FR-010 (resolved via clarification) explicitly
rule out the reference screenshot's back-control and quote-card elements, leaving the panel with no
content that requires copy at all.

**Alternatives considered**: Carrying over the login brand panel's headline/supporting-sentence pattern
was considered — rejected because the reassuring, step-specific messaging for this screen
("You're almost in — just set your own password.") already lives in the form column's existing banner;
duplicating a second piece of marketing copy on the panel would be redundant and outside this spec's
FR-002 scope (which enumerates the form column's contents exhaustively and does not add new panel copy).

## 5. Source of the form column's workspace wordmark

**Decision**: Read the `x-tenant-name` request header in `apps/web/app/set-password/page.tsx` (falling
back to `subdomain` if absent), the exact pattern `(dashboard-shell)/layout.tsx` already uses, and pass
it as a new `tenantName` prop to `SetPasswordForm`.

**Rationale**: `apps/web/middleware.ts` already sets `x-tenant-name` on every tenant request (verified:
lines setting `requestHeaders.set("x-tenant-name", data.tenantName)`), and `(dashboard-shell)/layout.tsx`
already reads it this exact way for its sidebar identity display. Reusing this precedent means zero new
fetches, zero new API surface, and consistency with how the platform already resolves tenant identity
post-login — as opposed to `017-fix-login-ui`'s pre-login `tenant-login-form.tsx`, which necessarily
fetches `tenantName` from `/tenant-routing/resolve` because no session/middleware-resolved header exists
yet at that point in the flow.

**Alternatives considered**: Fetching `tenantName` via `/tenant-routing/resolve` (matching
`017-fix-login-ui`'s pre-login approach) was considered — rejected because `/set-password` only renders
for an already-authenticated session (the page already redirects unauthenticated visitors to `/tenant`
before this component ever renders), so the middleware-resolved header is already available and cheaper
than an extra fetch.
