# Feature Specification: Super Admin Platform Dashboard Shell

**Feature Branch**: `007-super-admin-dashboard`

**Created**: 2026-07-04

**Status**: Draft

**Input**: User description: "Build a persistent dashboard shell for platform Super Admins, mirroring the Role-Based Dashboard Shell pattern (two-tier sidebar: icon rail + expandable category panel, collapsible/minimizable), landing immediately after Super Admin login. Surface the existing tenant-provisioning wizard and the existing permissions/role-template catalog view from this shell's sidebar, restyled to the current locked design system. No new platform capability — this is about giving existing capabilities a shell."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Land directly on the platform dashboard shell after login (Priority: P1)

A Super Admin logs in at the platform login page and is taken directly to a persistent dashboard
shell (sidebar plus main content area) — never today's bare "You're authenticated as a platform
Super Admin" confirmation page.

**Why this priority**: This is the entire deliverable — the frame every other capability in this
spec (and future platform-level capabilities) lives inside.

**Independent Test**: Log in as a Super Admin and confirm the browser lands directly on the platform
dashboard shell, with the persistent sidebar visible and a minimal identity summary (name, email,
last login) as the home content.

**Acceptance Scenarios**:

1. **Given** a Super Admin has just entered correct credentials, **When** login succeeds, **Then**
   they land directly on the platform dashboard shell — no separate confirmation page shown first.
2. **Given** the shell has loaded, **When** the Super Admin looks at the page, **Then** a persistent
   sidebar is visible (icon rail, collapsible) alongside a main content area showing their identity
   summary, styled per the established design system.

---

### User Story 2 - Provision a new tenant from the dashboard (Priority: P1)

A Super Admin opens the "Provision Tenant" section from the dashboard sidebar and completes the
existing multi-step provisioning wizard (company details, departments, admin account) without
leaving the shell, restyled to match the current locked design system rather than its original ad hoc
styling.

**Why this priority**: Provisioning is the single most important Super Admin capability today (it's
how every tenant enters the platform) and currently has no discoverable entry point — a Super Admin
has to already know the exact URL. Making it reachable from the shell is the core practical value of
this feature.

**Independent Test**: From the dashboard shell, navigate to Provision Tenant, complete all three
existing wizard steps with valid data, submit, and confirm the same success summary (tenant ID,
subdomain, admin account, departments) appears as today — restyled, with unchanged underlying
behavior.

**Acceptance Scenarios**:

1. **Given** a Super Admin is on the dashboard shell, **When** they select "Provision Tenant" from
   the sidebar, **Then** the existing provisioning wizard loads inside the shell frame, restyled to
   the current design system, with its step-by-step flow and validation behavior unchanged.
2. **Given** a Super Admin completes the wizard and submits, **When** provisioning succeeds, **Then**
   the same success summary data (tenant, departments, admin) is shown as today.

---

### User Story 3 - View the permissions and role-template catalog from the dashboard (Priority: P2)

A Super Admin opens the "Permissions" section from the dashboard sidebar and sees the existing
platform-wide permission and role-template catalog, restyled but functionally unchanged, without
needing to already know its URL.

**Why this priority**: This page already exists and is useful for understanding what each role
template grants, but today it's unreachable except by typing its exact URL — lower priority than
provisioning since it's a read-only reference view, not a day-to-day operational task.

**Independent Test**: From the dashboard shell, select "Permissions" and confirm the same permission/
role-template data shown today still renders correctly, restyled.

**Acceptance Scenarios**:

1. **Given** a Super Admin is on the dashboard shell, **When** they select "Permissions" from the
   sidebar, **Then** the existing permission/role-template catalog loads inside the shell frame,
   restyled, with the same data and behavior as today.

---

### Edge Cases

- What happens if a Super Admin's session expires while on any page inside this shell? The existing
  Super Admin session-guarding behavior (redirect to platform login) applies unchanged — this feature
  does not change session/auth handling, only adds a persistent navigation frame around already-guarded
  pages.
- What happens if provisioning fails validation or the server rejects it (e.g. duplicate subdomain)?
  Unchanged from today — the wizard's existing error handling and messaging are preserved as-is.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Immediately after a successful Super Admin login, the system MUST route to the
  platform dashboard shell — no separate generic confirmation page shown first.
- **FR-002**: The dashboard shell MUST provide a persistent, collapsible sidebar (icon rail plus
  expandable category panel, mirroring the tenant-side Role-Based Dashboard Shell's mechanism and
  minimize/collapse behavior) alongside a main content area, styled per the established design system.
- **FR-003**: The shell's sidebar MUST provide a "Provision Tenant" destination that loads the
  existing tenant-provisioning wizard, restyled to the current design system, with its existing
  step flow, validation, and submission behavior unchanged.
- **FR-004**: The shell's sidebar MUST provide a "Permissions" destination that loads the existing
  permission/role-template catalog view, restyled to the current design system, with unchanged data
  and behavior.
- **FR-005**: The shell's home view MUST show the Super Admin's own identity summary (name, email,
  last login) — the same fields shown on today's bare confirmation page, just inside the new shell.
- **FR-006**: Every page reachable from this shell MUST remain guarded by the existing Super Admin
  session check — this feature adds navigation, not a new authorization mechanism.
- **FR-007**: The shell and everything reachable from it MUST operate strictly at the platform level
  — no tenant_id-scoped data is read or displayed anywhere in this shell (provisioning creates a new
  tenant; the permissions view reads the platform-wide catalog, not any single tenant's data).
- **FR-008**: The shell MUST include a log-out control, consistent with the tenant-side shell.

### Key Entities

- **Super Admin identity** *(existing, Super Admin Authentication spec)*: name, email, last login —
  read by this feature to populate the home view, not modified.
- **Provisioned tenant** *(existing, Tenant Provisioning Core spec)*: unchanged — this feature only
  relocates/restyles the wizard that creates one, it does not change what gets created.
- **Permission / role-template catalog** *(existing, Roles & Permissions Model spec)*: unchanged —
  this feature only relocates/restyles the view of it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of successful Super Admin logins land directly on the platform dashboard shell,
  with zero intermediate generic confirmation screens.
- **SC-002**: A Super Admin can reach both Provision Tenant and Permissions from the shell's sidebar
  without needing to know or type either page's URL.
- **SC-003**: Provisioning a tenant through the restyled wizard produces an identical outcome (same
  tenant/department/admin data created) as the pre-existing wizard did.
- **SC-004**: Zero tenant-scoped data appears anywhere in this shell — verified by inspection, since
  every data source used here is platform-wide (Super Admin identity, tenant-provisioning inputs/
  outputs, permission catalog).

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: No change — this feature is entirely platform-level (no
  `tenant_id` scoping applies to any page or data source it touches). Provisioning already creates
  tenant rows through its existing, unchanged endpoint; nothing here reads or writes tenant-scoped
  tables directly.
- **Tenant-configurable vs. fixed platform-wide**: N/A for tenant configurability — this is
  internal platform-operator tooling, not a tenant-facing or tenant-configurable surface at all.
- **AI-generation review/approval step**: N/A — no AI-generated content involved.
- **Kirkpatrick L4/L5 data source & formula**: N/A — no Results/ROI data involved.
- **Downgrade/cancellation behavior**: N/A — not a security, budget, or evaluation module.
- **Design system reference**: Reuses the design system locked during Tenant Authentication
  Configuration (`design-system/tm/MASTER.md`) and the two-tier sidebar mechanism established in the
  Role-Based Dashboard Shell spec — same colors/typography, platform-internal chrome (no tenant
  white-labeling applies here, per Principle VII's distinction between internal design system and
  tenant branding).
- **Demoable vs. internal**: Demoable — see Demo Flow below.

## Assumptions

- No new Super Admin capability is added by this feature — it exclusively gives existing capabilities
  (provisioning, permission/role-template catalog viewing) a discoverable, persistent navigation
  frame. Any future platform-level capability gets its own spec and simply adds a new sidebar entry.
- The provisioning wizard's and permissions page's existing logic, validation, and API calls are
  reused as-is; only their visual styling and surrounding navigation change.
- The tenant-side and platform-side dashboard shells are separate implementations sharing the same
  visual pattern and design system, not a single shared component — they serve different session
  types (tenant user session vs. Super Admin session) and different navigation content, matching how
  the codebase currently keeps tenant-auth and platform-auth as parallel-but-separate systems.

## Demo Flow

This feature is demoable. Demo flow: log in as a Super Admin, land directly on the platform dashboard
shell showing the identity summary; open "Provision Tenant" from the sidebar and complete the wizard
to create a new tenant, showing the same success summary as before but restyled and reached without
typing a URL; then open "Permissions" from the sidebar and show the same permission/role-template
catalog, also restyled and reachable from the shell.
