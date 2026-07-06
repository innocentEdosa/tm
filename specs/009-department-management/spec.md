# Feature Specification: Department Management

**Feature Branch**: `009-department-management`

**Created**: 2026-07-05

**Status**: Draft

**Input**: User description: "Department Management for the TM multi-tenant SaaS — view, create, edit, and delete departments with hierarchical (parent/child) support, gated by department.view / department.manage permissions, following the same permission-gating pattern as the Team Directory's team.view.all / team.view.department. Inserted after Team Member Invitations and unblocks department-scoped visibility in the Team Directory spec."

## Clarifications

### Session 2026-07-05

- Q: A reference UI screenshot (an employee-directory table with row checkboxes and a bulk-selection
  bar) was supplied as a loose style guide — should the Department list adopt multi-select bulk
  actions (e.g. bulk archive/delete), or stay single-row only? → A: Stay single-row only — no bulk
  multi-select for departments; Edit/Delete/Archive remain per-row icon actions only, as already
  specified. The reference image is used for layout/pattern inspiration only (search placement,
  primary button style, expandable-row pattern), not as a literal feature request.

### Session 2026-07-06

- Q: Can a department's Manager / Assistant Manager be any user in the tenant, or must they already
  be a member assigned to that specific department? → A: Any tenant user — the picker searches every
  user in the tenant regardless of that user's own department assignment, matching common org
  patterns where a manager oversees a department without necessarily being "in" it.
- Q: Are Manager and Assistant Manager required fields when creating/editing a department, or
  optional? → A: Optional, both — consistent with Description already being optional; a department
  can exist with no manager assigned yet.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the department structure (Priority: P1)

An HR/L&D admin (or anyone else holding view access) opens the Department list and sees every
department their tenant has, laid out as a searchable, expandable tree so parent and child
departments are visible together at a glance.

**Why this priority**: This is the foundation everything else in this spec builds on, and it is
independently valuable on its own — a tenant's default departments already exist from provisioning
(Principle II), so simply being able to see and search that structure is useful before any
create/edit capability is added.

**Independent Test**: With a tenant that already has a handful of departments (some nested), open
the Department list and confirm the full hierarchy renders correctly, search narrows it correctly, and
a user without view access never sees the nav entry or the page's data.

**Acceptance Scenarios**:

1. **Given** a tenant with departments at multiple hierarchy levels, **When** a user holding
   `department.view` opens the Department list, **Then** every department is shown with its parent
   relationship visible (nested under its parent, or shown as top-level with "—" for parent), its
   direct member count, its status, and its Manager (or "—" if unassigned).
2. **Given** the Department list, **When** the user types part of a department's name into search,
   **Then** matching departments appear, with each match's ancestor chain still visible so it is not
   shown without context.
3. **Given** a tenant with zero departments, **When** the list is opened, **Then** it shows "No
   departments yet — create your first department to start organizing your team." rather than an
   empty table.
4. **Given** a user who holds neither `department.view` nor `department.manage`, **When** they are
   authenticated in the dashboard, **Then** the Department nav entry does not appear, and a direct
   request to the department list or any department API route returns a forbidden response.

---

### User Story 2 - Build out and adjust the department structure (Priority: P1)

An HR/L&D admin holding manage access creates new departments, nests them under a parent to build a
multi-level org structure (e.g. Org → Division → Team), and edits an existing department's name,
parent, description, or Manager/Assistant Manager as the organization changes.

**Why this priority**: This is the core management capability the feature exists to deliver — without
it, a tenant is stuck with only whatever departments provisioning created, contradicting Principle II's
requirement that department structure be tenant-adjustable without a code change.

**Independent Test**: As a user holding `department.manage`, create a top-level department, create a
second department nested under it, then edit the second one to rename it and confirm both the name
change and its position in the hierarchy update correctly.

**Acceptance Scenarios**:

1. **Given** the "Add department" action (visible only with `department.manage`), **When** a user
   submits a name, optional parent, optional description, and an optional Manager and/or Assistant
   Manager (each any user in the tenant), **Then** the new department appears in the list in its
   correct position in the hierarchy, with the assigned Manager/Assistant Manager saved.
2. **Given** an existing department name already in use within the tenant, **When** a user tries to
   create or rename another department to that same name (regardless of letter case), **Then** the
   attempt is rejected with an inline message before anything is saved.
3. **Given** the parent-department picker on create or edit, **When** it is opened for a given
   department, **Then** that department itself and all of its own descendants are excluded from the
   list of selectable parents, and any parent that would place the department at a fourth hierarchy
   level is also excluded.
4. **Given** a user attempts to set a department's parent via a direct API call to a value the UI
   would have excluded (itself, a descendant, or a cross-tenant department), **When** the request is
   processed, **Then** it is rejected server-side regardless of what the client sent.
5. **Given** the Manager and Assistant Manager pickers on create or edit, **When** a user searches for
   a person, **Then** any user in the tenant is selectable (not limited to members already assigned to
   that department), and selecting the same person for both Manager and Assistant Manager on the same
   department is rejected with an inline message.

---

### User Story 3 - Retire a department safely (Priority: P2)

An HR/L&D admin removes a department that is no longer needed, or archives one that is on pause,
without ever silently losing track of the people or sub-departments that pointed to it.

**Why this priority**: Protects data integrity once departments and their assignments exist (built in
User Story 2) — important, but structurally dependent on there being departments to retire, so it
follows create/edit in priority.

**Independent Test**: Attempt to delete a department that still has members assigned and confirm it is
blocked with a specific count and a working shortcut to reassign them; then delete an empty leaf
department and confirm it succeeds; then archive a department that has members and confirm archiving
succeeds where deletion was blocked.

**Acceptance Scenarios**:

1. **Given** a department (or any of its descendant departments) that still has members assigned,
   **When** a user with `department.manage` tries to delete it, **Then** the deletion is blocked with
   "This department has N member(s). Reassign them before deleting." (N counted across the department
   and its descendants) and a shortcut into the Members list, pre-filtered to that scope.
2. **Given** a department that has one or more child departments, **When** a user tries to delete it,
   **Then** the deletion is blocked until the children are deleted or reparented elsewhere.
3. **Given** a department with no members anywhere in its subtree and no child departments, **When** a
   user with `department.manage` deletes it, **Then** it is removed in a single confirmed action.
4. **Given** a department blocked from deletion for any reason, **When** the user chooses to archive it
   instead, **Then** its status becomes Archived without requiring its members or children to be
   removed or reassigned first.

---

### User Story 4 - Only active departments offered for new assignments (Priority: P3)

Anyone assigning a department elsewhere in the product (the Members list's department filter today; a
future Invite flow's department field) only ever sees active departments in that picker, so no one is
newly assigned into a department that has been wound down.

**Why this priority**: Valuable polish and a dependency for other specs (the Team Directory), but it
only matters once departments — and the archived status from User Story 3 — exist, and it touches
surfaces outside this feature's own screens.

**Independent Test**: Archive a department that has existing members, then open any department-picker
used for new assignments elsewhere in the product and confirm the archived department does not appear
in it, while the existing members' records still show their (archived) department correctly.

**Acceptance Scenarios**:

1. **Given** an archived department, **When** any picker used to newly assign a department is opened
   elsewhere in the product, **Then** that department does not appear as a selectable option.
2. **Given** members already assigned to a department before it was archived, **When** their existing
   records or historical reports are viewed, **Then** the archived department still displays correctly
   — archiving never hides or breaks an existing assignment.

---

### Edge Cases

- What happens when a department has no parent? Its parent is shown as "—", not left blank or omitted.
- What happens when two departments in the same tenant differ only by letter case (e.g. "Sales" vs.
  "sales")? Treated as the same name and rejected as a duplicate.
- What happens when a chosen parent would push a department to a fourth hierarchy level? That parent
  option is excluded from the picker; a direct API attempt to set it is rejected server-side too.
- What happens when a department is archived while it still has active child departments? Each
  department's status is independent — archiving a parent does not cascade to its children, and
  vice versa.
- What happens when a Super Admin (platform-level session) attempts to reach a tenant's department
  data? Out of scope for this tenant-scoped feature — Super Admin does not operate through this
  surface, consistent with the existing platform/tenant session boundary.
- What happens to the Department list itself once departments are archived? They remain visible in the
  list (with their status shown) — only pickers used for *new* assignments exclude them.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow any user holding `department.view` to see every department belonging to
  their own tenant, including each department's hierarchical parent/child relationship.
- **FR-002**: System MUST allow any user holding `department.manage` to create a new department with a
  required name, an optional parent department, and an optional description.
- **FR-003**: System MUST allow any user holding `department.manage` to edit an existing department's
  name, parent department, description, and status.
- **FR-004**: System MUST reject a department name that duplicates, case-insensitively, another
  department's name within the same tenant — on both create and edit — before saving.
- **FR-005**: System MUST prevent a department from being assigned a parent that is itself, any of its
  own descendants, or a department in a different tenant, at any depth — excluded from the
  parent-selection picker in the UI, and independently re-validated server-side regardless of what a
  client submits.
- **FR-006**: System MUST cap the department hierarchy at 3 levels of depth and prevent (both in the
  parent picker and server-side) any parent assignment that would place a department beyond that
  depth.
- **FR-007**: System MUST scope every department record, query, and mutation to the acting user's own
  tenant, including rejecting any parent-department reference that points to a different tenant, even
  via a direct API call bypassing the UI.
- **FR-008**: System MUST allow a user holding `department.manage` to delete a department only when
  neither it nor any of its descendant departments has any members currently assigned, and only when it
  has no child departments — with a specific, distinguishable reason shown when either condition blocks
  the deletion.
- **FR-009**: System MUST offer archiving (setting status to Archived) as an alternative to deletion,
  available regardless of whether the department currently has members or child departments, and
  reversible back to Active at any time.
- **FR-010**: System MUST exclude archived departments from any picker used to newly assign a
  department (e.g. a Members-list filter used for reassignment, a future Invite flow's department
  field), while continuing to display archived departments anywhere existing assignments or historical
  records/reports are shown.
- **FR-011**: System MUST hide the Department navigation entry for any user holding neither
  `department.view` nor `department.manage`.
- **FR-012**: System MUST return a forbidden response for any direct attempt to reach a department
  route or perform a department action without the corresponding permission (`department.view` for
  read access, `department.manage` for create/edit/delete), independent of whether the nav entry is
  hidden.
- **FR-013**: System MUST treat `department.manage` as inherently including `department.view` — a user
  granted manage access never lacks view access.
- **FR-014**: System MUST support searching the department list by name across the tenant's full
  hierarchy, keeping each match's ancestor chain visible so a nested match is never shown without its
  parent context.
- **FR-015**: System MUST display, for each department, its direct member count (members assigned
  directly to that department, not summed across its descendants — descendants already appear as
  their own rows in the expandable tree), its parent department's name (or "—" if top-level), its
  status, and its Manager (or "—" if unassigned).
- **FR-016**: When a deletion is blocked due to existing members, System MUST state the total member
  count summed across the department and all of its descendant departments, and provide a direct path
  into the Members list, pre-filtered to that same department-plus-descendants scope.
- **FR-017**: System MUST show a distinct empty state — "No departments yet — create your first
  department to start organizing your team." — when a tenant has zero departments, separate from a
  "no search results" state when a search simply has no matches.
- **FR-018**: System MUST perform edit, delete, and archive actions on one department at a time —
  no multi-select bulk actions (e.g. bulk delete, bulk archive) are supported for departments.
- **FR-019**: System MUST allow a department to optionally have one Manager and one Assistant
  Manager, each selectable from any user within the same tenant — not restricted to users already
  assigned to that specific department (Clarifications).
- **FR-020**: System MUST reject assigning the same user as both Manager and Assistant Manager of the
  same department.
- **FR-021**: System MUST NOT factor Manager/Assistant Manager assignment into the deletion-blocking
  rule (FR-008) — a department with a Manager and/or Assistant Manager assigned but no members and no
  child departments deletes normally; the assignment is simply cleared along with the deleted row, not
  a separate safeguarded relationship the way member/child assignments are.

### Key Entities

- **Department**: A tenant-owned organizational unit. Attributes: name (required, unique per tenant,
  case-insensitive), description (optional), status (Active or Archived, default Active), an optional
  parent department (enabling up to 3 levels of hierarchy), an optional Manager and an optional
  Assistant Manager (each any user in the tenant, not necessarily a member of this department), and a
  derived direct member count. Belongs to exactly one tenant; a department's parent, if set, must
  belong to that same tenant.
- **Department Assignment**: The relationship between a team member and the one department they
  currently belong to. A member has at most one department at a time (their "home" department, which
  may be reassigned or cleared).
- **Permission**: This spec adds two entries to the platform-wide permission catalog established by
  the Roles & Permissions model — `department.view` (read-only access) and `department.manage`
  (create/edit/delete, and inherently view). Like every other permission, these are assigned to
  tenant-owned roles by an admin, never hardcoded to a specific role name.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user with manage access can create a new department and see it appear correctly placed
  in the hierarchy without leaving the list view.
- **SC-002**: 100% of attempts to save a duplicate (case-insensitive) department name within a tenant
  are rejected before the record is saved.
- **SC-003**: 100% of attempts — from the UI or a direct API call — to assign a department as its own
  ancestor, at any depth, or to a cross-tenant parent, are rejected.
- **SC-004**: 0% of department deletions ever silently remove or orphan a member or a child department
  — every blocked deletion attempt shows its specific reason in the same interaction.
- **SC-005**: A department with no members anywhere in its subtree and no children can be deleted in a
  single confirmed action.
- **SC-006**: Users without department view or manage access never see the Department nav entry, and
  100% of direct route or API access attempts without the required permission are denied.
- **SC-007**: Every department picker used elsewhere in the product for new assignments shows zero
  archived departments, while existing assignments to an archived department remain visible wherever
  historical records are shown.
- **SC-008**: A user can locate any department, regardless of hierarchy depth, using the search box,
  with matches (and their ancestor chain) appearing as they type.
- **SC-009**: An admin can assign, change, or clear a department's Manager and Assistant Manager
  independently of every other department field, choosing from any user in the tenant, without that
  choice being restricted by — or affecting — the department's membership or deletion rules.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: Shared schema with RLS, consistent with the rest of the platform —
  every department row carries `tenant_id`, and the existing explicit-policy-clause pattern
  (`app.tenant_id` or `app.is_super_admin`) applies to all department reads/writes. The self-referencing
  parent relationship is additionally constrained (both in RLS and at the application layer) so a
  parent reference can never cross a tenant boundary.
- **Tenant-configurable vs. fixed platform-wide**: Per Principle II, the department tree itself
  (names, hierarchy, descriptions, active/archived status) is fully tenant-configurable — every tenant
  builds and restructures its own departments independently of any other tenant. The two new
  permission keys (`department.view`, `department.manage`) are platform-fixed catalog entries, added
  once for all tenants (per the Roles & Permissions model, Spec 001) — but *which* tenant roles carry
  those keys remains entirely tenant-configurable, same as every other permission.
- **AI-generation review/approval step**: N/A — this feature generates no AI content.
- **Kirkpatrick L4/L5 data source & formula**: N/A for this spec directly. Flagged for forward
  compatibility: a future Departmental TNA (Training Needs Analysis) competency-gap feature is expected
  to consume `department_id` directly from this feature rather than introducing a separate department
  taxonomy of its own (see Assumptions).
- **Downgrade/cancellation behavior**: N/A — Department Management is core organizational structure
  (Principle II), not a security, budget, or evaluation module, and is not itself plan-tier gated.
- **Design system reference**: Uses the established design system (Desktop Shell Visual Language spec)
  — the tenant dashboard's sidebar already has a disabled "Department" placeholder entry under its
  "Administration" category (Soon tag) that this spec's nav-gating requirements (FR-011, FR-012)
  activate. List, create/edit, and empty-state UI follow that same spec's Card, Badge, and page-header
  patterns rather than introducing new styles.
- **Demoable vs. internal**: Demoable — a full user-facing flow (view, create, edit, delete/archive a
  department hierarchy) with visible UI at every step.

## Assumptions

- A team member has at most one department at a time (a single "home" department, nullable). Multiple
  simultaneous department memberships per person are out of scope for this spec, consistent with the
  deletion-blocked message's singular "reassign them" framing.
- The Department list's per-row member count is the *direct* count for that exact department, not a
  rollup including descendants — descendants already appear as their own rows with their own counts in
  the expandable tree, so summing would double-count. The one exception is the deletion-blocked
  message (FR-016), which intentionally sums across the department and all its descendants, because
  that wider scope is exactly what the deletion rule itself blocks on.
- Archiving a department does not cascade to its children's status, and vice versa — each department's
  Active/Archived status is set independently, consistent with this platform's broader "no silent
  cascade" stance on structural changes.
- The Department list continues to show archived departments (their status visibly marked) alongside
  active ones; only pickers used for *new* assignments filter them out (FR-010).
- The Manager/Assistant Manager pickers (FR-019) search across every user in the tenant, which
  requires some way to look up tenant users by name — a capability that does not fully exist yet in
  this codebase (only user *creation* exists today, no list/search). This spec's scope includes the
  minimal user-search capability the picker itself needs, not a general-purpose user directory —
  that remains the not-yet-built Team Directory spec's job, same boundary already drawn for the
  Members-list dependency above.
- A user may be Manager of one department and Assistant Manager (or Manager) of a different
  department simultaneously — this spec places no cap on how many departments one person can manage.
  The only restriction (FR-020) is within a single department: the same person cannot be both its
  Manager and its Assistant Manager at once.
- This spec names its two new permission keys `department.view` and `department.manage` (dot-notation),
  per the feature request. This differs from the snake_case style used by permissions already shipped
  in this codebase (e.g. `manage_team_members`, `approve_enrollment`) — flagged here as a naming
  inconsistency for the team to reconcile (standardize one style or knowingly accept both), rather than
  silently normalized to either convention by this spec.
- The "Team Directory" (with its `team.view.all` / `team.view.department` permission split) and a
  future "Invite" flow are separate, not-yet-built specs referenced here only as downstream consumers
  of this feature's Active-departments-only picker behavior (User Story 4). The one such picker that
  already exists today — the tenant dashboard's Members list (built in the Role-Based Dashboard Shell /
  Desktop Shell Visual Language specs) — is in scope to update; building a new Team Directory filter or
  Invite-flow field is not.
- Department short-codes/IDs for HR system import mapping are not modeled by this spec — flagged as an
  open item for later confirmation once an HR-import feature is actually scoped.
- The 3-level depth cap is enforced by excluding any parent option that would place a department at a
  fourth level from the parent-selection picker (the same mechanism already used to exclude self and
  descendants), rather than allowing the selection and only rejecting it after submission.
