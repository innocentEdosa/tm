# Feature Specification: Split-Screen Tenant Login Layout

**Feature Branch**: `017-fix-login-ui`

**Created**: 2026-07-15

**Status**: Draft

**Input**: User description: "Restyle the tenant login page into a two-column split-screen layout, modeled on a reference screenshot: a wide branded visual panel on one side (wordmark, a large value-proposition headline, a supporting sentence, and a decorative preview visual filling the lower area) paired with a narrower credentials-form column on the other side. Mirror the reference: the brand panel goes on the LEFT, the form goes on the RIGHT, facing the user. The login form itself (fields, labels, links, SSO buttons, submit behavior, error handling) must not change — this is a visual/layout restructure only. Keep the existing locked design system (navy/blue tokens, Plus Jakarta Sans) rather than adopting the reference's color scheme. Applies to the tenant login page only."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Tenant user lands on a more polished, on-brand login screen (Priority: P1)

A tenant workspace user (e.g. an HR admin or employee) navigates to their organization's subdomain
and, instead of the current bare centered form, sees a two-column screen: a wide left panel carrying
the workspace's identity and a short value statement, and their familiar login form in a column on the
right. They sign in exactly as before — same fields, same links, same behavior — just inside a more
finished-looking layout.

**Why this priority**: This is the entire scope of the feature — there is no lower-priority slice.
Without this, the visual restructure hasn't happened at all.

**Independent Test**: Visit a tenant subdomain's root URL while signed out. Confirm the page renders
two columns (brand panel left, form right) on a standard desktop viewport, the form fields work
exactly as before, and a successful login still redirects to `/dashboard` or `/set-password` per
existing logic.

**Acceptance Scenarios**:

1. **Given** a signed-out user visits a valid tenant subdomain on a desktop-width viewport, **When**
   the page loads, **Then** a brand panel is visible on the left (workspace name/wordmark, a headline,
   a supporting sentence, and a decorative visual) and the login form is visible in a column on the
   right.
2. **Given** the split-screen layout is showing, **When** the user enters valid credentials and
   submits, **Then** the existing redirect behavior (to `/set-password` if a password change is
   required, otherwise `/dashboard`) occurs unchanged.
3. **Given** the split-screen layout is showing, **When** the user enters invalid credentials, **Then**
   the same error banner appears in the form column as it does today, with no change in wording or
   placement logic.
4. **Given** a tenant has multiple auth methods enabled, **When** the page loads, **Then** the
   email/password fields, the "or" divider, and the SSO buttons render in the form column in the same
   order and with the same conditional logic as the current implementation.

---

### User Story 2 - Layout stays usable on narrow screens (Priority: P2)

A tenant user opens the login page on a phone or narrow browser window. The two-column layout isn't
appropriate at that width, so the page falls back to a single, full-width column containing just the
login form (the brand panel is not squeezed into an unusable sliver).

**Why this priority**: The current page is already a usable single-column mobile layout; this story
protects that behavior from regressing when the desktop split-screen is introduced.

**Independent Test**: Resize the browser (or use a mobile emulation viewport) below the tablet
breakpoint and confirm the brand panel is hidden and the form column expands to use the full width,
matching today's centered single-column presentation.

**Acceptance Scenarios**:

1. **Given** a viewport narrower than the tablet breakpoint, **When** the login page loads, **Then**
   the brand panel is not shown and the form renders full-width, centered, as it does today.
2. **Given** a viewport at or above the desktop breakpoint, **When** the login page loads, **Then**
   the two-column layout described in User Story 1 is shown.

---

### Edge Cases

- What happens when neither `email_password` nor any SSO method is enabled for the tenant? The
  existing "No login method is currently configured" message must still render correctly inside the
  right-hand form column, with the brand panel unaffected.
- What happens when `tenantName` is very long? The brand panel's wordmark and the form column's
  "Welcome to {tenantName}" heading must truncate or wrap gracefully rather than breaking the layout or
  overflowing the viewport.
- What happens when the decorative visual fails to load or render (e.g. slow network for any
  supporting asset)? The form column must remain fully usable and the brand panel must degrade to at
  least its background color, wordmark, and text without blocking page interactivity.
- What happens at a viewport width exactly at the responsive breakpoint boundary? The layout must pick
  one deterministic presentation (no flash of both/neither column).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The tenant login page MUST present a two-column layout on desktop-width viewports: a
  wide brand/visual panel on the left and a narrower credentials-form column on the right.
- **FR-002**: The brand panel MUST display the tenant's workspace identity (the existing `tenantName`
  value, consistent with how it is already shown elsewhere, e.g. the dashboard shell sidebar), a short
  headline describing the product's value, one supporting sentence, and a decorative visual filling
  the remaining lower area of the panel.
- **FR-003**: The decorative visual in the brand panel MUST be an original, on-brand graphic (e.g. an
  abstract pattern, shapes, or a lightweight illustrative composition) and MUST NOT depict fabricated
  product data, screenshots, or metrics that could be mistaken for real content.
- **FR-004**: The login form (fields, labels, "Forgot password?" link, SSO button list, error/status
  banners, submit button, and all associated behavior) MUST render unchanged in content, order, and
  logic — only its position within the page layout changes.
- **FR-005**: The visual restructure MUST NOT alter any authentication behavior: the API calls made,
  the redirect targets, the conditions under which SSO buttons vs. the email/password form appear, and
  the error-message logic MUST all remain exactly as they are today.
- **FR-006**: The brand panel MUST use only colors, typography, and surface styles already defined in
  the project's locked design system — no new colors or fonts introduced for this feature.
- **FR-007**: Below a defined tablet-width breakpoint, the brand panel MUST NOT render, and the login
  form column MUST expand to a full-width, centered presentation matching the page's current
  single-column layout.
- **FR-008**: The brand panel's headline and supporting sentence MUST describe this product's value
  (workspace/team management) rather than reusing reference-material copy verbatim.
- **FR-009**: This layout change applies only to the tenant login page
  (`apps/web/app/tenant/tenant-login-form.tsx` and its parent `apps/web/app/tenant/page.tsx`). The
  tenant-status, forgot-password, set-password, and platform/login pages are unaffected by this
  feature.
- **FR-010**: Long tenant names MUST NOT break the layout — the brand panel and the form column's
  "Welcome to {tenantName}" heading MUST truncate or wrap without overflowing their containers.

### Key Entities

- **Tenant workspace identity**: The existing `tenantName` and `subdomain` values already passed into
  the login form — reused for display in the brand panel; no new data is introduced.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a desktop-width viewport, 100% of tenant login page loads show the two-column layout
  (brand panel + form column) rather than the current single centered column.
- **SC-002**: Existing login functionality (successful sign-in, invalid-credential error, no-method
  configured, SSO placeholder notice) behaves identically before and after this change, verified by
  exercising each path with no change in outcome.
- **SC-003**: On a mobile-width viewport, the page remains a single, fully usable column — no
  horizontal scrolling and no visual overlap between the (hidden) brand panel and the form.
- **SC-004**: The redesigned page uses zero colors or fonts outside the project's existing design-
  system tokens, verified by inspection of the implementation against `globals.css`.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: No change — this feature touches presentation only and reuses
  data (`tenantName`, `subdomain`, `enabledAuthMethods`) already scoped and fetched per-tenant by the
  existing page.
- **Tenant-configurable vs. fixed platform-wide**: The brand panel displays the tenant's own name
  (already tenant-specific, consistent with the dashboard shell). Per-tenant custom logo/color
  branding is intentionally out of scope for this feature — no such configuration exists yet in the
  product; this feature reuses the platform's single locked design system for the panel's visual
  styling, the same way the rest of the tenant-facing shell does today.
- **AI-generation review/approval step**: N/A — no AI-generated content involved.
- **Kirkpatrick L4/L5 data source & formula**: N/A — not a Results/ROI feature.
- **Downgrade/cancellation behavior**: N/A — not a security, budget, or evaluation module.
- **Design system reference**: Must use the existing locked design system established in
  `apps/web/app/globals.css` ("Design system lock" tokens: `--color-primary`, `--color-cta`,
  `--color-surface`, `--color-border`, Plus Jakarta Sans). No new palette or typography introduced.
- **Demoable vs. internal**: Demoable — this is a visible, stakeholder-facing change to the tenant
  login screen.

## Assumptions

- The "tablet-width breakpoint" for collapsing to single-column follows the project's existing
  responsive conventions (a standard `md`/`lg`-scale breakpoint); an exact pixel value is a
  planning/implementation decision, not a spec-level one.
- No per-tenant custom logo image exists today, so the brand panel identifies the workspace via its
  name/wordmark text only, matching current dashboard-shell precedent — this can be extended later if
  a tenant branding/logo-upload feature is introduced.
- The decorative visual is a static, CSS/SVG-based graphic (no new image assets, animation libraries,
  or external dependencies), consistent with the constitution's preference for built-in tooling over
  new dependencies.
- Existing copy on the form side ("Welcome to {tenantName}", "Sign in to your workspace.") is
  preserved as-is; this spec only adds new copy for the brand panel's headline/subtext.
