# Feature Specification: Desktop Shell Visual Language

**Feature Branch**: `008-desktop-shell-visual-language`

**Created**: 2026-07-05

**Status**: Draft

**Input**: User description: "Establish the shared visual language and layout structure for TM's authenticated desktop shell (sidebar, topbar, content area), used as the base frame for the Role-Based Dashboard Shell and every screen built after it. Layout and styling only — not role-specific content. Adds a topbar (breadcrumb, utility icons, tenant identity badge) that doesn't exist today, formalizes card and status-badge/pill patterns, and refines the accent color and typography rules. Built via the UI-UX-Pro-Max skill."

## Clarifications

### Session 2026-07-05

- Q: Should the tenant dashboard's shell and the Super Admin platform dashboard's shell (two
  separate implementations today, by deliberate earlier decision) converge onto this one shared
  layout component, or does this spec refine only the tenant-facing shell? → A: Converge both —
  this spec supersedes the Super Admin Platform Dashboard spec's "separate implementation" decision;
  both dashboards render through the one shell established here.
- Q: A reference screenshot supplied with this spec uses a purple/indigo accent, contradicting the
  spec's own "blue, not purple/indigo" requirement — which wins? → A: Blue wins, matching the
  already-locked design system (`design-system/tm/MASTER.md`, CTA `#0369a1`) and the original written
  requirement. The reference is used for layout/structure only (icon rail, grouped sidebar, topbar
  composition, card/list patterns), not its color palette.
- Q: A second reference (a screen recording of a different product) supersedes the icon-rail +
  panel + topbar structure above with a single-column sidebar (logo, static workspace-label pill,
  sectioned nav with expandable groups, bottom-pinned user identity block) and no topbar at all —
  does this spec adopt that structure, and does its green active-state color come with it? → A:
  Adopt the structure (this spec now describes a single-column sidebar with no topbar, superseding
  the icon-rail/topbar requirements below), but the accent color does not change — active nav
  states, primary buttons, and badges stay on the already-locked blue (`#0369a1`), per the same
  "reference for structure only, not color" rule as the first clarification.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A coherent shell renders with placeholder content (Priority: P1)

Any authenticated user sees a single, coherent shell — one fixed-width sidebar (app mark, a static
workspace-label pill, sectioned nav with expandable groups, and a bottom-pinned user identity block)
and a content area with a standard page-header pattern — even before any real page content exists
inside it. There is no separate icon rail and no topbar.

**Why this priority**: This is the entire deliverable. Without a working shell frame, nothing else in
this spec (card pattern, badge pattern) has anywhere to live, and no future feature can be built
against it.

**Independent Test**: Render the shell with an empty/placeholder content area and confirm every
structural region is present and visually distinct: sidebar (brand mark, workspace pill, at least one
labeled nav section, bottom identity block) and a content area showing a page title and subtitle with
no topbar above it.

**Acceptance Scenarios**:

1. **Given** a user is on any page inside the shell, **When** the page loads, **Then** the sidebar and
   content area are both visible, separated by a single hairline border, not a heavy divider or drop
   shadow, and no topbar is rendered.
2. **Given** the sidebar shows multiple nav items, **When** one item corresponds to the current page,
   **Then** that item's active state is visually distinct from every inactive item (per the single
   blue accent, not decorative color variety).
3. **Given** the sidebar's bottom-pinned identity block, **When** it renders, **Then** it shows an
   initials-avatar circle, the current user's name/primary label, and a secondary label (e.g. email or
   role) — the block is a static display only, not an interactive control (explicitly out of scope
   here).
4. **Given** the sidebar's workspace-label pill (when a workspace/tenant concept applies), **When** it
   renders, **Then** it shows the workspace name as a static, non-interactive display (no switcher
   behavior).
5. **Given** the content area, **When** any page renders inside it, **Then** it shows a page header
   (title + short subtitle) as the first thing in the content area, followed by standard padding
   around whatever content that page defines.

---

### User Story 2 - Both dashboards render through one shared shell (Priority: P1)

A Super Admin on the platform dashboard and a tenant user on the tenant dashboard both see the same
sidebar structure and styling — differing only in which nav items, workspace-label content, and
identity-block content appear — because both render through the one shell established here, not two
separately maintained implementations.

**Why this priority**: The two dashboards currently use separate, hand-rolled sidebar components
built before this spec (Role-Based Dashboard Shell and Super Admin Platform Dashboard specs). Left
unconverged, every future visual refinement would need to be made twice and would drift apart —
converging them is core to "establishing a shared visual language," not an optional follow-up.

**Independent Test**: Load the tenant dashboard and the Super Admin platform dashboard side by side
and confirm both use visually identical sidebar chrome (spacing, colors, active-state treatment,
hairline border) — only the nav items, workspace-label presence/content, identity-block content, and
page content differ.

**Acceptance Scenarios**:

1. **Given** a tenant user viewing their dashboard and a Super Admin viewing the platform dashboard,
   **When** both shells render, **Then** the sidebar looks and behaves identically in structure and
   style — spacing, colors, active-state treatment, and hairline border match exactly.
2. **Given** each dashboard's own distinct nav items (e.g. tenant Team Members/Authentication Settings
   vs. platform Provision Tenant/Permissions), **When** each shell renders its own nav, **Then** only
   the item content differs — not the shell mechanism rendering them.
3. **Given** the platform (Super Admin) shell has no tenant/workspace concept, **When** it renders,
   **Then** it omits the workspace-label pill entirely rather than rendering an empty or fake one.

---

### User Story 3 - Reusable card and status-badge patterns are available (Priority: P2)

A developer building a future feature (e.g. a team roster showing invite status, or a tenant-status
indicator) can use an already-established card component and status-badge/pill component instead of
inventing new styling.

**Why this priority**: These patterns are explicitly called out as reused by near-term future work
(invite statuses, tenant statuses, approval states) — establishing them now prevents each subsequent
feature from re-deriving its own ad hoc version, but the shell itself (User Story 1) is usable and
demoable without this.

**Independent Test**: Render a sample card with representative content and a set of status badges
(e.g. success, warning, neutral) side by side and confirm they follow one consistent style — rounded
corners, hairline border, consistent internal padding for the card; tinted background with matching
darker text for each badge state.

**Acceptance Scenarios**:

1. **Given** a card component wrapping arbitrary content, **When** it renders, **Then** it shows
   rounded corners, a hairline border, and consistent internal padding, matching every other card
   instance on the page.
2. **Given** a status badge in any of its defined states (e.g. success, warning, neutral), **When** it
   renders, **Then** it shows a pill shape with a tinted background and a matching darker text color
   distinct from the other states.

---

### Edge Cases

- What happens on a very short viewport where the content area's content exceeds visible height? The
  content area scrolls independently; the sidebar remains fixed/visible (standard desktop shell
  behavior) — full scroll-behavior detail is an implementation concern, not a new requirement here.
- What happens if no nav item matches the current page (e.g. a page reachable only via a bare link,
  not from the sidebar)? No sidebar item shows an active state — the shell doesn't force a false match.
- What happens to an expandable nav group whose current page is inside it, while the group itself is
  closed? Every group defaults closed, even one containing the active route — but a closed group
  still shows its one active child, indented beneath the (unhighlighted) toggle row, rather than
  hiding it entirely. Expanding the group (manual toggle) reveals every child, active one included, at
  which point the toggle row itself shows the active-group highlight. A group with no active
  descendant shows nothing beneath it while closed, same as before.
- What happens on a dashboard shell with no workspace/tenant concept (the platform shell)? The
  workspace-label pill is omitted entirely, not rendered empty.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The shell MUST render a single fixed-width sidebar (~256px) on the far left — there is no
  separate icon rail. The sidebar's top region MUST show an app mark + wordmark.
- **FR-001a**: Directly below the app mark, the sidebar MAY show a static workspace-label pill (e.g.
  the tenant name) when a workspace/tenant concept applies to that shell instance; a shell instance
  with no such concept (e.g. the platform/Super Admin shell) omits it entirely. The pill is a static
  display only — no click behavior, no switcher.
- **FR-002**: Below the app mark (and workspace pill, if present), the sidebar MUST render its nav as
  one or more sections, each a list of icon + text rows, with sections visually separated by hairline
  dividers. A row MAY instead be an expandable group (icon + text + chevron) that reveals its child
  rows indented beneath it, connected by a vertical guide line, when expanded.
- **FR-002a**: The tenant dashboard shell and the Super Admin platform dashboard shell MUST both
  render through this one shared shell layout — not two separate implementations (superseding the
  Super Admin Platform Dashboard spec's earlier "separate implementation" decision, Clarifications).
- **FR-003**: The shell MUST visually distinguish the active/selected nav item from every inactive
  item, using the single established accent color — never decorative color variety.
- **FR-004**: The shell MUST NOT render a topbar. The main content area begins directly with each
  page's page-header (title + subtitle, FR-006) at its top.
- **FR-005**: The sidebar MUST render a bottom-pinned, static identity block showing an initials-avatar
  circle, the current user's primary label (e.g. name or email), and an optional secondary label (e.g.
  email or role) — not an interactive control (no click behavior, no switcher), per this spec's
  explicit scope boundary. A "Log out" nav-styled row MUST render immediately above this block.
- **FR-006**: The shell MUST render a main content area to the right of the sidebar, with standard page
  padding and a page-header pattern (title + short subtitle) that any page rendered inside it can use.
- **FR-007**: The shell MUST render correctly with an empty or placeholder content area — no real page
  content is required for the shell itself to be considered complete.
- **FR-008**: The visual style MUST be flat and light — no gradients, no drop shadows except on
  functional focus states (e.g. keyboard focus rings).
- **FR-009**: The established accent color MUST be a single blue (not purple/indigo, not green), used
  only for active nav states, primary buttons, and highlighted badges — not for general decoration.
- **FR-010**: The boundary between the sidebar and the content area MUST be a hairline border, not a
  heavy divider or drop shadow.
- **FR-011**: All shell and content text MUST use sentence case — no all-caps text anywhere in the
  system established by this spec.
- **FR-012**: A reusable card pattern MUST be established: rounded corners, hairline border, consistent
  internal padding, usable by any future feature that groups content.
- **FR-013**: A reusable status-badge/pill pattern MUST be established, supporting at minimum
  success, warning, and neutral states, each with a tinted background and matching darker text color.
- **FR-013a**: A sidebar nav row MAY show a trailing indicator: either a muted count (plain text
  number, no background) or an outline tag pill (e.g. "Soon", a short capability code) — visually
  distinct from the success/warning/neutral status-badge pattern (FR-013), which is for page content,
  not nav rows.
- **FR-014**: Color tokens, spacing values, and the card/badge patterns established by this spec MUST
  be documented so subsequent specs can reference them instead of inventing new styles.

### Key Entities

*(No new data entities — this spec is purely presentational/structural. It reads no new backend
data. The workspace-label pill displays the tenant name already resolved by the existing tenant
session mechanism. The identity block displays whatever the current session already exposes about
the logged-in user (the platform session's `name`/`email`; the tenant session has no personal display
name, so its identity block uses `email` as the primary label and `roleName` as the secondary label).
Nav items reflect whatever the Role-Based Dashboard Shell spec already determines is visible to the
current user.)*

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every screen built on top of this shell going forward reuses the same icon rail,
  sidebar, topbar, and content-area structure without needing its own layout code.
- **SC-001a**: The tenant dashboard and the Super Admin platform dashboard both use the identical
  shell implementation — zero duplicated sidebar/topbar code remains between them.
- **SC-002**: 100% of future card-shaped content and status indicators across the product use the
  patterns established here, rather than a one-off style per feature.
- **SC-003**: A person unfamiliar with the system can visually distinguish the active nav item from
  inactive ones, and distinguish a success badge from a warning badge, without reading any
  accompanying text label.
- **SC-004**: The shell renders correctly (no missing regions, no layout breakage) with a completely
  empty content area, proving it does not depend on any specific page's content to function.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: No change — this spec introduces no new data access. Converging
  the tenant and Super Admin shells (Clarifications) does not blur tenant isolation: the shared shell
  component receives already-resolved, already-isolated data (nav items, identity content) as inputs
  from each dashboard's own unchanged session logic — it never itself resolves a session or crosses
  the tenant/platform boundary.
- **Tenant-configurable vs. fixed platform-wide**: The shell's structure, color tokens, and card/badge
  patterns are fixed platform-wide by design (Principle V) — this is the internal design system, not a
  tenant-configurable surface. Tenant white-labeling (logo/colors) remains a separate, later concern
  per Principle VII and is explicitly out of scope here (only the tenant *name* is shown, statically).
- **AI-generation review/approval step**: N/A — no AI-generated content.
- **Kirkpatrick L4/L5 data source & formula**: N/A — no Results/ROI data.
- **Downgrade/cancellation behavior**: N/A — not a security, budget, or evaluation module.
- **Design system reference**: This spec *is* the design-system-establishing work for the shell layer,
  performed via the UI-UX-Pro-Max skill per Principle V — it refines and formalizes the ad hoc shell
  pattern first introduced in the Role-Based Dashboard Shell spec (icon rail + panel, collapse
  behavior, `sidebar-*` CSS classes), replacing that icon-rail/panel/topbar composition with a
  single-column sidebar (workspace-label pill, sectioned/expandable nav, bottom-pinned identity block,
  no topbar), and elevates informal card/badge styling already used ad hoc in a few places (e.g. tag
  pills in the provisioning success summary) into a documented, reusable pattern. Once locked here, it
  becomes binding for all subsequent screens, per the existing constitution rule.
- **Demoable vs. internal**: Demoable — see Demo Flow below.

## Assumptions

- **Superseded**: the earlier icon-rail + always-expanded-panel + topbar structure (this spec's first
  design) and the whole-sidebar collapse-to-icon-rail behavior it carried over from the Role-Based
  Dashboard Shell spec are both replaced by the single-column sidebar with per-group expand/collapse
  described above (second Clarification). The sidebar itself has one fixed width and is not
  collapsible as a whole; a labeled group's own expand/collapse state is the only collapse mechanism
  now.
- Converging both shells means the shared shell component itself holds no assumption about which kind
  of session it's serving — it receives nav sections, active state, workspace-label content (if any),
  and identity-block content as inputs. Each dashboard's own existing session-resolution logic (tenant
  session vs. Super Admin session, already implemented, unchanged by this spec) continues to determine
  what those inputs are before handing them to the shared shell.
- The second reference's additional product-specific nav items (Conversations, Contacts, Broadcasts,
  Library, etc.) are that other product's own business content, not part of what this spec adopts —
  only the *structural/visual pattern* (single-column sidebar, sectioned nav, expandable groups with
  indentation + guide line, count/tag badges, bottom-pinned identity block, no topbar) is established
  here. TM's own nav items (Team Members, Authentication Settings, Provision Tenant, Permissions, etc.)
  are unchanged in content.
- The exact composition and naming of sidebar nav sections/groups is a design-phase decision, not
  fixed by this spec — the requirement is structural (at least one section must be supported, and
  groups MAY be collapsible), not a mandate on specific section names or contents.
- Mobile/responsive behavior is out of scope (explicitly flagged by the user) and is left as a
  candidate for a future spec if needed.

## Demo Flow

This feature is demoable. Demo flow: render the shell with a placeholder/empty content area to show
the sidebar (brand mark, workspace-label pill, sectioned nav with active vs. inactive states and an
expandable group, bottom-pinned identity block) and the content area's page-header pattern — all in
isolation, without any real dashboard content, and with no topbar present. Then show a sample card and
a row of status badges (success/warning/neutral) to demonstrate the reusable patterns other features
will adopt.
