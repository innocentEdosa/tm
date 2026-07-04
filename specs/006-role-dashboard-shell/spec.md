# Feature Specification: Role-Based Dashboard Shell

**Feature Branch**: `006-role-dashboard-shell`

**Created**: 2026-07-04

**Status**: Draft

**Input**: User description: "Build the area a user lands on immediately after logging in, with content determined by their assigned role. This is a minimal shell — NOT the full analytics dashboards. Depends on Roles & Permissions Model (Spec 1), Team Member Invitations, and Tenant Authentication Configuration (Spec 4/5). Follow-up: scope narrowed to the shell/navigation frame only — team roster, Training Needs Analysis entry point, approvals placeholder, and other per-role dashboard content are explicitly deferred to a later spec."

## Clarifications

### Session 2026-07-04

- Q: The Manager shell wants a direct-reports overview, but no manager/report or department-membership relationship exists in the data model today (confirmed: `users` and `departments` have no linking column). How should the Manager shell handle this? → A: Honest placeholder only — same "not available yet" treatment as pending approvals. No new schema/migration in this feature; direct-reports becomes real once org-structure/department-membership is modeled in a later spec. (Superseded by the scope narrowing below — this feature no longer builds role-specific dashboard content at all, so this decision now applies to the later spec that adds it.)
- Q: Follow-up from the user after the initial draft: is per-role dashboard *content* (team roster, TNA entry point, approvals placeholder) in scope for this feature? → A: No — this feature builds only the persistent navigation shell and role-based routing. All per-role dashboard content is deferred to a later spec.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Land directly on a persistent dashboard shell after login (Priority: P1)

Any successfully authenticated user — HR Admin, Manager, or Employee/Learner — is taken directly from login to a persistent dashboard shell (a stable sidebar/navigation frame plus a main content area), never a shared generic landing page shown first.

**Why this priority**: This is the entire deliverable of this feature — the frame every future dashboard page will live inside. Nothing else in this feature matters without it.

**Independent Test**: Log in as any team member and confirm the browser lands directly on the dashboard shell (persistent sidebar visible, main content area rendered) with no intermediate generic page.

**Acceptance Scenarios**:

1. **Given** a user has just entered correct credentials, **When** login succeeds, **Then** they land directly on the dashboard shell — no shared/generic landing screen shown first.
2. **Given** the shell has loaded, **When** the user looks at the page, **Then** a persistent sidebar/navigation frame is visible alongside a main content area, styled per the established design system (not a bare/unstyled page).
3. **Given** the main content area has no real dashboard content built yet for any role, **When** the user views it, **Then** it shows an honest, well-designed "more to come" placeholder — never fabricated data (fake counts, sample charts, etc.).

---

### User Story 2 - Sidebar reflects what the user actually has access to (Priority: P2)

The shell's sidebar shows navigation entries the logged-in user actually has permission to use — including links into pages that already exist (e.g. Authentication Settings, Team Members, from Spec 5) — rather than a single identical menu for every role.

**Why this priority**: This makes the shell immediately useful (it's a real way to reach existing settings pages) instead of pure scaffolding, and proves the shell is wired to the same permission system as the rest of the app, not a hardcoded per-role list.

**Independent Test**: Log in as an HR Admin (who has `manage_team_members` and `manage_authentication_settings`) and as an Employee/Learner (who has neither), and confirm the sidebar's entries differ accordingly — the HR Admin sees links to Team and Authentication Settings; the Employee/Learner does not.

**Acceptance Scenarios**:

1. **Given** a logged-in HR Admin, **When** the shell renders, **Then** the sidebar includes entries linking to the existing Team Members and Authentication Settings pages.
2. **Given** a logged-in Employee/Learner (no admin permissions), **When** the shell renders, **Then** the sidebar does not show entries the user has no permission to use.
3. **Given** any user, **When** they click a sidebar entry pointing at a page that doesn't exist yet, **Then** it is visibly disabled/labeled "coming soon" rather than a broken link (mirrors the precedent already established for SSO login stubs in Spec 5).

---

### Edge Cases

- What happens when a user's role assignment is somehow missing at login time (should not occur given every account is created with exactly one role at provisioning or invitation, but the system must not silently show a blank page)? The shell MUST show a clear error state directing the user to contact their HR Admin, never a blank screen or a crash.
- What happens when a still-must-change-password session (Spec 5's OTP bootstrap flow) somehow reaches the shell directly? The existing forced-password-change redirect (Spec 5) takes precedence — the shell is only reachable after that requirement is satisfied.
- What happens when a user has zero permission-gated sidebar entries available to them (e.g. a baseline Employee/Learner)? The sidebar still renders (with only its universal entries, if any) — it is never left empty/broken just because a role has no admin permissions.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Immediately after a successful login, the system MUST route the user to the dashboard shell — no shared generic landing page shown first.
- **FR-002**: The dashboard shell MUST provide a persistent, always-visible sidebar/navigation frame alongside a main content area, styled per the established design system.
- **FR-003**: The main content area MUST show an honest, intentionally-designed "more to come" placeholder for every role — no fabricated data, counts, or charts of any kind. Real per-role dashboard content (team roster, Training Needs Analysis entry point, approvals, etc.) is explicitly out of scope for this feature.
- **FR-004**: The sidebar MUST show navigation entries reflecting the logged-in user's actual permissions — including real links to pages that already exist (Team Members, Authentication Settings, from Spec 5) for users permitted to use them, and MUST NOT show entries for actions the user has no permission to take.
- **FR-005**: A sidebar entry pointing at a page that doesn't exist yet MUST render in a visibly disabled "coming soon" state, never as a broken link.
- **FR-006**: The system MUST determine which sidebar entries and role context to show strictly from the user's actual assigned role/permissions (Spec 1's roles & permissions model), never from a client-supplied value.
- **FR-007**: All shell content MUST be scoped to the logged-in user's own tenant — no data from any other tenant is ever retrievable or displayed.
- **FR-008**: If a logged-in user's role cannot be determined (e.g., no role is currently assigned), the system MUST show a clear, actionable error state instead of a blank page or a default shell.

### Key Entities

- **User Role Assignment** *(existing, Spec 1)*: the single role (HR/L&D Admin, Manager, or Employee/Learner) and its associated permissions that determine which sidebar entries a user sees; this feature reads it but does not change how roles or permissions are assigned.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of successful logins land the user directly on the dashboard shell, with zero intermediate generic landing screens.
- **SC-002**: An HR Admin can reach the existing Team Members and Authentication Settings pages from the shell's sidebar without navigating away from the shell frame.
- **SC-003**: A user with no admin permissions never sees a sidebar entry for an action they cannot perform.
- **SC-004**: Zero instances of fabricated/placeholder data (fake counts, sample charts, etc.) appear anywhere in the shell's main content area.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: No schema change to the tenant-isolation model — reuses the existing shared-schema-with-RLS approach (Spec 1/2/4/5). No new tables or columns are introduced by this feature.
- **Tenant-configurable vs. fixed platform-wide**: The shell's navigation *structure* is fixed platform-wide (not tenant-configurable) — every tenant's users get the same sidebar mechanism. What varies per tenant/user is only which entries are visible, driven entirely by the existing per-tenant role/permission assignments (Spec 1), consistent with Principle III.
- **AI-generation review/approval step**: N/A — this feature displays no AI-generated content.
- **Kirkpatrick L4/L5 data source & formula**: N/A — this feature shows no Results/ROI data.
- **Downgrade/cancellation behavior**: N/A — this feature is not a security, budget, or evaluation module. (Existing tenant-status handling from Spec 4 already covers suspended/cancelled tenants before login is even reachable.)
- **Design system reference**: Builds on the design system locked during Tenant Authentication Configuration (Spec 5, `design-system/tm/MASTER.md`) — same navy/blue B2B palette and typography. The persistent sidebar-navigation *pattern* (icon rail + labeled entries) takes structural inspiration from a reference screenshot provided with this spec; exact visual treatment is a design-phase decision, not fixed here.
- **Demoable vs. internal**: Demoable — see Demo Flow below.

## Assumptions

- A user holds exactly one role at a time (confirmed by the feature description) — no UI or logic for choosing among multiple roles is needed.
- Real per-role dashboard content — team roster with invite status, a Training Needs Analysis entry point, an approvals placeholder, and any direct-reports/org-structure view — is explicitly deferred to a later spec. This feature's main content area is a single, honest "more to come" placeholder shared by all roles.
- The reference screenshot's icon-rail-plus-panel navigation pattern is a structural/visual reference for the design phase, not a literal requirement to replicate every element (course catalogs, pricing, etc. are out of scope here).
- The sidebar's permission-gated entries in this feature link only to pages that already exist today (Team Members, Authentication Settings) — no new destination pages are built by this feature.

## Demo Flow

This feature is demoable. Demo flow: log in as an HR Admin and show the persistent sidebar with working links to Team Members and Authentication Settings, plus the shared "more to come" main content placeholder; then log in as an Employee/Learner in the same tenant and show the sidebar correctly omits the admin-only entries while still landing directly on the same shell frame.
