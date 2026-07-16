# Feature Specification: Split-Screen Change Password Layout

**Feature Branch**: `018-fix-change-password-ui`

**Created**: 2026-07-15

**Status**: Draft

**Input**: User description: "Update the Change Password UI to match the layout/visual guide shown in the screenshot (a two-panel auth layout: left side has a simple centered form with logo, heading, subheading, input field(s), a full-width primary button, and a footer link; right side has a large rounded image panel with a back arrow button top-left and a testimonial/quote card overlay at the bottom-right with navigation arrows). Keep the existing color palette/theme already used in the app (do not adopt the black/white/beige colors from the screenshot) — only follow the screenshot for structure, spacing, layout, and component composition. This is for the Change Password screen specifically, not the login or reset-password screen."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Tenant user completes the forced password change on a more polished screen (Priority: P1)

A tenant user who has just logged in for the first time (or via a system-issued one-time code) is
required to choose their own password before reaching the dashboard. Instead of the current bare,
centered form, they see a two-column screen: their password form in a column on the left (workspace
wordmark, the "Choose your password" heading, the reassurance message, the password fields, and a
full-width submit button), paired with a large decorative visual panel on the right. They complete the
same steps as before — same fields, same validation, same redirect — inside a more finished-looking
layout.

**Why this priority**: This is the entire scope of the feature — there is no lower-priority slice.
Without this, the visual restructure hasn't happened at all.

**Independent Test**: Sign in as a tenant user flagged to change their password. Confirm the
`/set-password` page renders two columns (form left, visual panel right) on a standard desktop
viewport, the form fields and submit button behave exactly as before, and a successful submission still
redirects to `/dashboard`.

**Acceptance Scenarios**:

1. **Given** a signed-in tenant user who must change their password lands on `/set-password` on a
   desktop-width viewport, **When** the page loads, **Then** a form column is visible on the left
   (reassurance message, heading, "New password" and "Confirm password" fields, submit button) and a
   decorative visual panel is visible on the right.
2. **Given** the split-screen layout is showing, **When** the user submits matching, valid passwords,
   **Then** the existing behavior (redirect to `/dashboard`) occurs unchanged.
3. **Given** the split-screen layout is showing, **When** the user submits mismatched passwords or the
   server rejects the request, **Then** the same error banner appears in the form column as it does
   today, with no change in wording or placement logic.

---

### User Story 2 - Layout stays usable on narrow screens (Priority: P2)

A tenant user completes this forced password change on a phone or narrow browser window. The
two-column layout isn't appropriate at that width, so the page falls back to a single, full-width
column containing just the password form (the visual panel is not squeezed into an unusable sliver).

**Why this priority**: The current page is already a usable single-column mobile layout; this story
protects that behavior from regressing when the desktop split-screen is introduced.

**Independent Test**: Resize the browser (or use a mobile emulation viewport) below the tablet
breakpoint and confirm the visual panel is hidden and the form column expands to use the full width,
matching today's centered single-column presentation.

**Acceptance Scenarios**:

1. **Given** a viewport narrower than the tablet breakpoint, **When** `/set-password` loads, **Then**
   the visual panel is not shown and the form renders full-width, centered, as it does today.
2. **Given** a viewport at or above the desktop breakpoint, **When** `/set-password` loads, **Then**
   the two-column layout described in User Story 1 is shown.

---

### Edge Cases

- What happens when the "Passwords don't match" or server-side error occurs? The error banner must
  still render correctly inside the left-hand form column, with the visual panel unaffected.
- What happens when the reassurance banner or heading text wraps onto multiple lines? The form column
  must expand vertically without breaking the two-column proportions or pushing the visual panel
  off-screen.
- What happens if any element inside the visual panel (image, decorative graphic, quote card) fails to
  render? The form column must remain fully usable and the visual panel must degrade to at least its
  background color without blocking page interactivity.
- What happens at a viewport width exactly at the responsive breakpoint boundary? The layout must pick
  one deterministic presentation (no flash of both/neither column).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The change-password page (`/set-password`) MUST present a two-column layout on
  desktop-width viewports: a narrower credentials-form column on the LEFT and a wide decorative visual
  panel on the RIGHT — the mirror image of the tenant login page's split established in
  `017-fix-login-ui` (where the brand panel is on the left).
- **FR-002**: The form column MUST contain, top to bottom: the workspace wordmark/identity, the
  existing reassurance banner ("You're almost in — just set your own password."), the "Choose your
  password" heading, the "New password" and "Confirm password" fields, and a full-width submit button —
  all with unchanged copy, order, and behavior from the current implementation.
- **FR-003**: The visual panel MUST be an original, on-brand decorative graphic. It MUST NOT depict
  fabricated product data, screenshots, or metrics that could be mistaken for real content, consistent
  with the precedent set in `017-fix-login-ui`.
- **FR-004**: The password form's fields, labels, client-side "passwords don't match" check, submit
  behavior, error banner, and redirect target MUST remain exactly as they are today — only their
  position within the page layout changes.
- **FR-005**: The visual restructure MUST NOT alter any authentication behavior: the API call made
  (`POST /tenant-api/tenant-auth/set-password`), the redirect target (`/dashboard`), and the
  error-message logic MUST all remain exactly as they are today.
- **FR-006**: The visual panel and form column MUST use only colors, typography, and surface styles
  already defined in the project's locked design system (`apps/web/app/globals.css`) — no new colors or
  fonts introduced for this feature, and specifically none of the black/white/beige tones shown in the
  reference screenshot.
- **FR-007**: Below a defined tablet-width breakpoint, the visual panel MUST NOT render, and the
  password form column MUST expand to a full-width, centered presentation matching the page's current
  single-column layout.
- **FR-008**: This layout change applies only to the change-password page
  (`apps/web/app/set-password/set-password-form.tsx` and its parent `apps/web/app/set-password/page.tsx`).
  The tenant login, forgot-password, and reset-password pages are unaffected by this feature.
- **FR-009**: The visual panel MUST NOT include a back-navigation control. Unlike the reference
  screenshot, `/set-password` is a mandatory step reached only via a forced-change redirect (spec 005
  FR-013a) — there is no prior page in this flow that isn't itself gated, so no back-arrow affordance is
  shown.
- **FR-010**: The visual panel MUST NOT include a quote/testimonial card attributed to a named or
  photographed individual. The reference screenshot's card ("Caitlyn Evergreen, Photographer") would
  read as a fabricated customer testimonial if reused verbatim, which conflicts with FR-003. The panel
  remains purely decorative (shapes/glow), consistent with the `017-fix-login-ui` brand panel's
  treatment — no card, quote, or navigation-arrow controls are introduced.

### Key Entities

- **Tenant session/user identity**: The existing authenticated tenant session and `subdomain` value
  already available to the `/set-password` page — reused for display in the form column; no new data is
  introduced.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a desktop-width viewport, 100% of `/set-password` page loads show the two-column
  layout (form column + visual panel) rather than the current single centered column.
- **SC-002**: Existing change-password functionality (successful submission and redirect, mismatched-
  password error, server-rejection error) behaves identically before and after this change, verified by
  exercising each path with no change in outcome.
- **SC-003**: On a mobile-width viewport, the page remains a single, fully usable column — no
  horizontal scrolling and no visual overlap between the (hidden) visual panel and the form.
- **SC-004**: The redesigned page uses zero colors or fonts outside the project's existing design-system
  tokens, verified by inspection of the implementation against `globals.css`.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: No change — this feature touches presentation only and reuses the
  existing authenticated tenant session already scoped per-tenant by the current page.
- **Tenant-configurable vs. fixed platform-wide**: The visual panel is a fixed, platform-wide decorative
  treatment (no tenant-specific branding), consistent with `017-fix-login-ui`'s precedent — per-tenant
  custom branding on auth screens remains out of scope for this feature.
- **AI-generation review/approval step**: N/A — no AI-generated content involved, pending resolution of
  FR-010 (no fabricated testimonial content will be introduced regardless of which option is chosen).
- **Kirkpatrick L4/L5 data source & formula**: N/A — not a Results/ROI feature.
- **Downgrade/cancellation behavior**: N/A — not a security, budget, or evaluation module.
- **Design system reference**: Must use the existing locked design system established in
  `apps/web/app/globals.css` ("Design system lock" tokens: `--color-primary`, `--color-cta`,
  `--color-surface`, `--color-border`, Plus Jakarta Sans) and the `.login-brand-panel` /
  `.login-brand-panel-glow` / `.login-brand-shape` treatment already introduced by `017-fix-login-ui`.
  No new palette or typography introduced.
- **Demoable vs. internal**: Demoable — this is a visible, stakeholder-facing change to the mandatory
  password-change screen.

## Assumptions

- The "tablet-width breakpoint" for collapsing to single-column matches the one already established by
  `017-fix-login-ui` for the tenant login page, for visual consistency between the two related screens.
- No per-tenant custom logo image exists today, so the form column identifies the workspace via its
  existing text-based identity, matching `017-fix-login-ui`'s precedent.
- The decorative visual panel is a static, CSS/SVG-based graphic reusing the existing
  `.login-brand-panel`-style tokens (no new image assets, animation libraries, or external
  dependencies), consistent with the constitution's preference for built-in tooling over new
  dependencies (Principle XII).
- Existing copy in the form ("You're almost in — just set your own password.", "Choose your password",
  field labels, button text) is preserved as-is; this spec only repositions it — no new copy is
  introduced for the visual panel, per the resolution of FR-009 and FR-010.
