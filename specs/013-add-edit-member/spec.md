# Feature Specification: Add/Edit Team Member

**Feature Branch**: `013-add-edit-member`

**Created**: 2026-07-08

**Status**: Draft

**Input**: User description: "Update the existing Add Member form to fix the Role ID issue and add
Department assignment. Render any tenant-configured custom fields for the 'member' form type
dynamically, appended after the fixed system fields, per the Custom Fields Framework's existing
rendering behavior. Support editing an existing member's details (not just the invite-time creation
flow) — the original spec only covered invite creation; this spec extends it to cover post-invite
edits (e.g. changing someone's department or role, or updating their custom field values) for
members with a team-management permission. Role (required) replaces the free-text 'Role ID' field
with a searchable dropdown of the tenant's roles (system + custom), storing the role's actual id.
Department (optional) is a new searchable dropdown showing hierarchy path, Active departments only.
Custom fields render dynamically, validated per the Custom Fields Framework's rules. UI should be in
a drawer/slide-out. Out of scope: bulk/CSV member creation, changing OTP/password-reset mechanics."

## Clarifications

### Session 2026-07-08

- Q: Should editing a member be org-wide only, or also have a department-scoped tier (mirroring the
  view permission's own all/department split)? → A: Org-wide only — matches today's
  `manage_team_members` exactly; a Manager still cannot edit anyone, only view. No department-scoped
  edit tier is introduced by this spec.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Admin creates a member with a working role picker and department assignment (Priority: P1)

An HR/L&D Admin (or anyone holding the team-creation permission) opens "Add member" from the Team
Members directory, which slides out a drawer instead of the always-visible inline form used today.
They pick the new member's role from a searchable dropdown of the tenant's actual roles (system and
custom) — never typing a raw role identifier — and optionally assign a department from a searchable,
hierarchy-aware dropdown that only lists departments currently in Active status.

**Why this priority**: This directly fixes a currently-broken, in-production control (a free-text
"Role ID" field that requires knowing an internal identifier by heart) and is the only way any new
member gets created at all — without it, the rest of this spec has nothing to edit.

**Independent Test**: Open "Add member," confirm the form renders in a slide-out drawer, search and
select an existing custom role and an active department by name (not id), submit, and confirm the
created member has exactly that role and department.

**Acceptance Scenarios**:

1. **Given** a tenant with both system roles (e.g. Manager) and custom roles, **When** the admin
   opens the Role dropdown, **Then** every role in the tenant appears, searchable by name.
2. **Given** the admin selects a role and submits, **When** the member is created, **Then** the
   stored role assignment is the selected role's actual id — never a display string.
3. **Given** a tenant with an archived department, **When** the admin opens the Department dropdown,
   **Then** the archived department does not appear as a selectable option.
4. **Given** a department hierarchy two levels deep, **When** the admin opens the Department
   dropdown, **Then** each option shows its full path (e.g. "Engineering > Backend"), not just a bare
   name.
5. **Given** the admin submits with no department selected, **When** the member is created, **Then**
   the member has no department assigned (Department remains optional).

---

### User Story 2 - Admin edits an existing member's role and department (Priority: P2)

An HR/L&D Admin (or anyone holding the team-management permission) opens an existing member's
profile from the directory and edits their role and/or department — a capability that does not
exist anywhere in the product today; previously, a member's role and department could only be set
once, at invite time.

**Why this priority**: This is the spec's core new capability, but it depends on User Story 1's
fixed Role/Department pickers already existing (the same form is reused for both create and edit) —
so it's correctly sequenced after, not instead of, the P1 fix.

**Independent Test**: As a team-management permission holder, open an existing member's profile,
click "Edit," change their department to a different Active department, save, and confirm the
directory and the member's own profile reflect the new department immediately.

**Acceptance Scenarios**:

1. **Given** an existing member currently assigned to Department A, **When** an authorized admin
   edits them and selects Department B, **Then** the member's department becomes B, and this is
   reflected the next time the directory list or that member's profile is loaded.
2. **Given** an existing member, **When** an authorized admin changes their role from one existing
   role to another, **Then** the member's role assignment updates to the newly selected role.
3. **Given** a user who holds only the team-viewing permission (not the team-management permission),
   **When** they open a member's profile, **Then** no "Edit" action is available to them at all —
   not merely disabled, hidden entirely, consistent with how the Roles Management UI already treats
   an unauthorized viewer's write actions.
4. **Given** the admin opens the edit form for a member, **When** the form loads, **Then** it is
   pre-filled with that member's current full name, role, department, and custom field values —
   never a blank form for an edit.

---

### User Story 3 - Tenant's own custom fields appear in the create/edit form (Priority: P3)

Whatever custom fields a tenant has configured for the "member" form type (per the existing Custom
Fields Framework — Personnel Number, Nationality, Contract Type, or anything else a given tenant has
set up) appear automatically in both the create and edit forms, in the tenant's own configured
display order, immediately below the fixed Full name/Email/Role/Department fields — with no code
change required when a tenant adds, removes, or reorders a field.

**Why this priority**: This is a real, valuable enhancement (it's what actually lets a tenant capture
Prevoli-style HR data) but the create/edit flow is fully usable without it, so it ranks below the
two stories that make create/edit work at all.

**Independent Test**: As a tenant that has configured two custom fields for "member," open the
create form and confirm both fields render (in their configured order) with the correct input type
for each; save a value for one, leave the other required-but-blank, and confirm submission is
blocked with a clear message identifying the missing required field.

**Acceptance Scenarios**:

1. **Given** a tenant with zero custom fields configured for "member," **When** the create/edit form
   opens, **Then** only the fixed fields (Full name, Email [create only], Role, Department) appear —
   no broken or empty custom-field placeholders.
2. **Given** a tenant with three custom fields configured for "member," one marked required, **When**
   the admin submits without filling the required one, **Then** submission is blocked with a
   field-level error identifying exactly which field is missing.
3. **Given** two different tenants with different custom fields configured for "member," **When**
   each tenant's admin opens the form, **Then** each sees only their own tenant's configured fields.

---

### Edge Cases

- The selected role is deleted or the selected department is archived between the form loading and
  the admin submitting: the server rejects the submission with a clear, specific error (role/department
  no longer valid) rather than silently succeeding with stale data or a generic failure.
- A direct API call (bypassing the dropdown's own filtering) supplies an archived department's id, or
  a role id belonging to a different tenant: both are rejected server-side, identically to how the
  dropdown itself would have prevented the selection in the UI.
- An admin edits their own member record and reassigns themselves away from their current role: this
  spec does not add any new lockout guard for this case — consistent with the Roles Management UI's
  own established reasoning that the tenant's initial admin account and system-role immutability
  together already provide the platform's actual safety net, not a per-edit runtime check.
- Editing a member currently assigned to a department that has since been deleted/archived: the edit
  form still opens and shows that member's other fields correctly; the Department field shows their
  current (now-archived) department as a distinct, clearly-labeled state, and saving without changing
  it leaves their assignment untouched — only changing to a *different* department is validated
  against the Active-only rule.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Add Member form MUST render in a slide-out drawer, not the always-visible inline
  page section it uses today.
- **FR-002**: Role MUST be a required, searchable dropdown populated from every role in the tenant
  (system and custom), replacing the current free-text "Role ID" input; the value submitted MUST be
  the role's actual id, never a display string typed or copied by the admin.
- **FR-003**: System MUST reject any submission whose role id does not resolve to an existing role
  belonging to the caller's own tenant.
- **FR-004**: Department MUST be an optional, searchable dropdown populated from the tenant's
  department hierarchy, showing each option's full ancestor path (e.g. "Engineering > Backend"), and
  MUST list only departments currently in Active status.
- **FR-005**: System MUST reject any submission whose department id is archived or belongs to a
  different tenant.
- **FR-006**: System MUST support editing an already-created member's full name, role, department,
  and custom field values — a capability that exists nowhere in the product prior to this spec.
- **FR-007**: Editing a member MUST be gated by a team-management permission, org-wide only — no
  department-scoped edit tier exists (clarified 2026-07-08); a user holding only a view permission
  (org-wide or department-scoped) MUST NOT see or reach any edit action for any member.
- **FR-008**: Any tenant-configured custom field for the "member" form type MUST render dynamically,
  in that tenant's own configured display order, in both the create and edit forms — appearing
  automatically for a newly-configured field with no code change.
- **FR-009**: Custom field values MUST be validated against the Custom Fields Framework's existing
  rules (required-field enforcement, type-appropriate value validation) on every create and edit
  submission.
- **FR-010**: The member directory's per-row Edit action MUST open this same create/edit form,
  pre-filled with that member's current full name, role, department, and custom field values.
- **FR-011**: Email MUST remain required at creation and MUST NOT be editable through this spec —
  changing an existing member's email is treated as a separate, materially bigger concern and is
  explicitly out of scope here.

### Key Entities

- **Team Member (existing `users` row)**: this spec adds no new columns — it extends which of the
  existing fields (full name, role assignment, department assignment) can be changed after creation,
  and adds a real, working selection mechanism for role and department at creation time.
- **Role / Department (existing entities)**: read-only from this spec's perspective — it selects
  among a tenant's existing roles and Active departments, never creates, renames, or restructures
  either.
- **Custom Field Definition & Value (existing entities, Custom Fields Framework)**: unchanged shape;
  this spec is the second real consumer (after Department) of dynamically rendering and validating a
  tenant's own "member"-scoped custom fields inside a create/edit form, not a new field-definition
  concept.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin can create a new member — selecting a real role and, optionally, a real
  department entirely by name — without ever needing to know or type an internal identifier.
- **SC-002**: An admin can change an existing member's department or role without deleting and
  recreating their account.
- **SC-003**: 100% of role and department values that reach storage are real, existing, Active (for
  department), same-tenant values — verified by direct API testing, not just UI inspection.
- **SC-004**: A newly tenant-configured custom field appears in the create/edit form with zero code
  changes to the form itself.
- **SC-005**: A user without the team-management permission has no path — through any UI control —
  to reach an edit action for any member.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: Shared schema w/ RLS — no change. Role and department lookups,
  and the new edit route, all read/write exclusively through `request.tenantDb`, exactly like every
  existing route this spec touches.
- **Tenant-configurable vs. fixed platform-wide**: Full name/Email/Role/Department remain the fixed,
  platform-wide core fields for every tenant; every other field a tenant sees in this form comes
  entirely from that tenant's own Custom Fields Framework configuration — this spec adds no new fixed
  HR-specific field.
- **AI-generation review/approval step**: N/A — no AI-generated content is involved.
- **Kirkpatrick L4/L5 data source & formula**: N/A — this feature does not touch Results/ROI
  evaluation.
- **Downgrade/cancellation behavior**: N/A — not a security, budget, or evaluation module.
- **Design system reference**: Reuses the established `Drawer` slide-out primitive (already used by
  Department's and Roles' own create/edit forms, and the Team Member Directory's own profile panel)
  — no new UI pattern introduced.
- **Demoable vs. internal**: Demoable — a stakeholder can directly create and edit a member through
  this screen.

## Assumptions

- **Populating the Role and Department dropdowns depends on the caller also holding the relevant
  read permission** (`roles.read`/`manage_roles` for the Role dropdown, `department.view`/
  `department.manage` for the Department dropdown) — this is an existing, already-accepted coupling
  (the current Add Member form already depends on `department.view` for its own department picker),
  not a new gap introduced here. Every role that holds the team-management permission today (HR/L&D
  Admin) already holds both, so this is not a practical blocker; it would only surface if a future
  custom role were given team-management access without also granting those read permissions.
- **A new `team.edit` permission is introduced**, granted to the HR/L&D Admin template, following the
  exact additive pattern already established for `team.create`/`team.view.all`/`team.view.department`
  — the existing `manage_team_members` permission continues to work as the superset, so no existing
  role's access changes.
- **Full name is editable through this same form; email is not.** Email touches login identity and
  notification delivery in a way a simple profile edit shouldn't casually risk — changing it is
  treated as a distinct, future concern, not requested here.
- **Deleting or deactivating a member remains entirely out of scope.** The directory's Delete action
  stays exactly as disabled as it is today; only the Edit action becomes functional in this spec.
- **No new "last admin" lockout guard is added** for an admin reassigning their own role away from an
  admin-level role — consistent with the Roles Management UI's own resolved reasoning that the
  tenant's always-present initial admin account and system-role immutability together are the
  platform's actual safety net, not a per-edit runtime check.
- **Bulk/CSV member creation and any change to the OTP/password-reset invite mechanics are out of
  scope**, per the feature description's own explicit declaration — bulk import is flagged as a clear
  future follow-on spec mirroring the Department CSV Import pattern.
