# Feature Specification: Training Needs Analysis (TNA)

**Feature Branch**: `014-training-needs-analysis`

**Created**: 2026-07-11

**Status**: Draft

**Input**: User description: "Training Needs Analysis (TNA) for the TM multi-tenant SaaS — a new "Learning" top-level sidebar section (peer to Administration and Settings) containing a "Training Needs Analysis" link at /learning/tna. HR/L&D Admins (role hr_admin) configure the TNA form's extra fields through the existing Custom Fields Framework (Spec 010: Settings > Forms, forms.manage.tenant) by registering a new training_needs_analysis row in form_definitions, so this module reuses that mechanism rather than building its own ad-hoc field editor. Department Managers (role manager) fill out and submit training-need requests for their own department only, scoped the same way Team Directory (Spec 012) scopes visibility — via the submitting user's own departmentId, not departments.manager_id — seeing their department's fixed system fields (e.g. training need / skill gap title, priority, target audience or number of staff affected, target quarter/period, justification) plus every global and tenant-added custom field in display_order, the same way Department's (Spec 009) form already consumes the framework. HR/L&D Admins can view and manage TNA submissions across all departments org-wide; Managers can only view/edit their own department's submissions — mirroring the team.view.all / team.view.department permission pairing pattern (e.g. tna.view.all / tna.view.department, tna.manage.all / tna.manage.department). Forms should follow the existing design system (@tm/ui, AppShell/NavSection) for visual consistency with the Department and Team Directory forms. Draft can be created and managers can edit after submitting."

## Clarifications

### Session 2026-07-11

- Q: Can a Manager delete their own training-need entry, or is deletion HR-only? → A: Managers can
  delete only their own Draft entries; once Submitted, only a user holding `tna.manage.all` can
  delete it.
- Q: A real client TNA template (screenshot) shows gap-analysis columns — Function, Type of Gap
  (Process/Tool-Technology/People, tick-all-that-apply), Observable Incidences, Steps Taken,
  Performance Expectation, Affected Job Roles, Recommended Training — with no priority or period
  column. Should these become fixed system fields, seeded global defaults, or tenant-added custom
  fields? → A: Kept as this tenant's own custom fields, added by their HR/L&D Admin via Settings >
  Forms (not hardcoded platform-wide, not seeded as Super-Admin global defaults) — "Type of Gap" maps
  onto the framework's existing multiselect field type. Fixed system fields are limited to: title,
  department, priority, and status.
- Q: Should HR/L&D Admins see a department's Draft (unsubmitted) entries, or only Submitted ones? →
  A: Only Submitted entries. Drafts are private to the authoring Manager until they submit.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Department Manager submits a training-need request for their department (Priority: P1)

A Department Manager navigates to Learning > Training Needs Analysis, creates a new training-need
entry for their own department, optionally saves it as a draft, submits it, and can keep editing it
afterward.

**Why this priority**: This is the entire reason TNA exists — capturing department-level training
needs. Without it, there is nothing for HR/L&D to view, filter, or configure fields for.

**Independent Test**: As a user holding the Manager role scoped to a department, open
`/learning/tna`, create a new training-need entry with the required fields filled in, save it, submit
it, and confirm it appears in the department's list with status "Submitted."

**Acceptance Scenarios**:

1. **Given** a Manager on `/learning/tna`, **When** they select "New Training Need," **Then** a form
   opens showing the fixed system fields (title / training-need description and priority) with
   department auto-scoped and not manually editable, followed by any configured global and tenant
   custom fields (e.g. this tenant's own Function, Type of Gap, Observable Incidences, Steps Taken,
   Performance Expectation, Affected Job Roles, and Recommended Training fields) in `display_order`.
2. **Given** a Manager filling the form, **When** they save without completing every field, **Then**
   the entry is stored with status "Draft," visible only to that Manager (and others scoped to the
   same department) — not to HR/L&D Admins — and can be reopened and edited later.
3. **Given** a Draft entry, **When** the Manager clicks Submit, **Then** required fields (system and
   custom) are validated, status changes to "Submitted," and the entry becomes visible to HR/L&D
   Admins org-wide.
4. **Given** a Submitted entry that their department authored, **When** the Manager edits any field,
   **Then** the change saves and the entry remains "Submitted" — editing after submission does not
   require re-approval or reset the status.
5. **Given** a Manager whose department has child departments, **When** they view `/learning/tna`,
   **Then** they see and can manage entries for their own department and its descendant departments,
   the same hierarchy-aware scoping Team Directory uses.
6. **Given** a user with no department assigned and no TNA permission, **When** they try to access
   `/learning/tna`, **Then** they are blocked from creating or viewing entries.
7. **Given** a Draft entry the Manager owns, **When** they delete it, **Then** it is removed from
   their list; **Given** the same entry has since been Submitted, **When** the Manager attempts to
   delete it, **Then** the action is blocked — only a user holding `tna.manage.all` can delete a
   Submitted entry.

---

### User Story 2 - HR/L&D Admin views and manages training-need submissions across every department (Priority: P2)

An HR/L&D Admin opens Learning > Training Needs Analysis and sees every department's Submitted
training needs in one place, filterable by department and priority, with the ability to edit or
remove any entry. Draft entries remain private to their authoring department until submitted.

**Why this priority**: Consolidating department-level input into one org-wide view is the payoff for
HR/L&D — without it, the data collected in Story 1 has nowhere to be planned against.

**Independent Test**: As a user holding `tna.view.all`, open `/learning/tna` and confirm Submitted
entries from multiple departments are visible in a single list, filterable by department and
priority.

**Acceptance Scenarios**:

1. **Given** an HR/L&D Admin on `/learning/tna`, **When** the list loads, **Then** Submitted entries
   from every department are shown, each labeled with its owning department and priority — Draft
   entries are excluded.
2. **Given** the department or priority filter, **When** the HR/L&D Admin applies it, **Then** the
   list narrows accordingly.
3. **Given** an HR/L&D Admin holding `tna.manage.all`, **When** they edit or delete any department's
   entry, **Then** the change saves without needing that department's own Manager to act.
4. **Given** a Manager who does not hold `tna.view.all`, **When** they open `/learning/tna`, **Then**
   only their own department's (and its subtree's) entries are shown, never another department's.

---

### User Story 3 - HR/L&D Admin adds custom fields to the TNA form (Priority: P3)

An HR/L&D Admin opens Settings > Forms, selects the "Training Needs Analysis" form type, and adds a
field their organization needs beyond the fixed system fields — using the same screen already built
for Department in Spec 010.

**Why this priority**: Valuable for tailoring data collection, but the module is already usable
end-to-end with just the fixed system fields from Story 1, so this ships after the core flow.

**Independent Test**: As a user holding `forms.manage.tenant`, open Settings > Forms, select
"Training Needs Analysis," add a field, and confirm it appears — in order, with validation enforced —
the next time a Manager opens `/learning/tna` to create an entry.

**Acceptance Scenarios**:

1. **Given** Settings > Forms, **When** an HR/L&D Admin selects the "Training Needs Analysis" form
   type, **Then** they see the same global/tenant field management UI already used for Department,
   with no new UI built for TNA specifically.
2. **Given** a newly added tenant field, **When** a Manager opens `/learning/tna` to create an entry,
   **Then** the field appears after the fixed system fields, in `display_order`, with its
   required/type validation enforced on submit.
3. **Given** a field key that collides with an existing global or tenant field for this form type,
   **When** the HR/L&D Admin tries to save it, **Then** the save is rejected inline, matching Spec
   010's existing behavior unchanged.

---

### Edge Cases

- What happens when a Manager's department has child departments? They see and can manage entries for
  their own department plus every descendant department in the hierarchy, not only their exact
  department — consistent with Team Directory's department-scoping.
- What happens when HR/L&D Admin adds a new required custom field after entries already exist?
  Existing Draft or Submitted entries are not retroactively invalidated; the new requirement is
  enforced the next time that entry is submitted or edited and resubmitted.
- What happens when a department referenced by a training-need entry is later deleted or archived?
  The entry retains its department reference so historical entries stay viewable and attributable,
  even though the department no longer appears in active department pickers.
- How does the system handle a Manager attempting to view or edit another department's entry directly
  (e.g. via a guessed URL or ID)? The request is rejected server-side, the same way department-scoped
  access is enforced elsewhere in the platform.
- How does the system handle a training-need entry when no custom fields are configured yet? The form
  renders only the fixed system fields — nothing breaks, consistent with Department's form before any
  custom fields exist.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a new "Learning" top-level sidebar section, permission-gated,
  containing a "Training Needs Analysis" link at `/learning/tna`.
- **FR-002**: System MUST allow a user holding `tna.manage.department` or `tna.manage.all` to create a
  new training-need entry, auto-scoped to their own department (or, for `tna.manage.all` holders, any
  department) with the department field not manually editable by department-scoped users.
- **FR-003**: Each training-need entry MUST support the fixed system fields: title (training need /
  skill-gap description), priority (fixed set: Low / Medium / High), an owning department reference,
  and a status of either "Draft" or "Submitted." All other data-collection fields (e.g. Function, Type
  of Gap, Observable Incidences, Steps Taken, Performance Expectation, Affected Job Roles, Recommended
  Training) are tenant-configured custom fields (FR-010–FR-012), never hardcoded platform-wide.
- **FR-004**: System MUST allow a Manager to save an entry as "Draft" without completing every
  required field, and to reopen and continue editing a Draft later.
- **FR-005**: System MUST validate all required fields (system and custom) at Submit time, at which
  point status transitions from "Draft" to "Submitted."
- **FR-006**: System MUST allow the originating Manager to continue editing an entry after it has been
  Submitted, without requiring a separate approval step or resetting its status.
- **FR-007**: System MUST scope list and detail visibility so that users holding `tna.view.department`
  see all entries (Draft and Submitted) for their own department and its descendant departments
  (hierarchy-aware, matching Team Directory's scoping), while users holding `tna.view.all` see
  **Submitted** entries across every department — Draft entries remain private to the authoring
  department and are never shown to `tna.view.all` holders.
- **FR-008**: System MUST scope edit and delete the same way via `tna.manage.department` vs.
  `tna.manage.all` — a department-scoped Manager MUST NOT be able to view, edit, or delete another
  department's entries. Within their own department, a Manager MAY delete only entries still in
  "Draft" status; once an entry is "Submitted," only a user holding `tna.manage.all` MAY delete it.
- **FR-009**: System MUST let users holding `tna.view.all` filter the org-wide (Submitted-only) list by
  department and by priority.
- **FR-010**: System MUST register a new `training_needs_analysis` form type in the existing Custom
  Fields Framework (Spec 010) so HR/L&D Admins configure extra TNA fields through the existing
  Settings > Forms screen (`forms.manage.tenant`), without a separate field-builder UI.
- **FR-011**: The training-need create/edit form MUST render the entry's fixed system fields followed
  by every applicable global and tenant-added custom field in `display_order`, the same way
  Department's form already consumes the framework.
- **FR-012**: System MUST persist custom field answers through the existing `custom_field_values`
  mechanism, tied to each training-need entry's id and scoped to the owning tenant.
- **FR-013**: System MUST style the Training Needs Analysis list and form using the established design
  system (existing `@tm/ui` components and `AppShell`/`NavSection` sidebar pattern) for visual
  consistency with the Department and Team Directory screens.
- **FR-014**: System MUST block access to `/learning/tna` and its underlying data for any user holding
  none of the `tna.*` permissions, consistent with existing permission-gating patterns.

### Key Entities

- **Training Need (TNA Entry)**: A single training-need request belonging to one department within
  one tenant. Holds title/skill-gap description, priority (Low/Medium/High), status
  (Draft/Submitted), the submitting Manager, and timestamps. Consumes tenant-configured custom field
  answers (e.g. Function, Type of Gap, Observable Incidences, Steps Taken, Performance Expectation,
  Affected Job Roles, Recommended Training) through the shared `custom_field_values` mechanism.
- **Form Definition (`training_needs_analysis`)**: The developer-registered form type, added to the
  existing Custom Fields Framework (Spec 010), that TNA's global and tenant custom fields attach to —
  no new field-configuration schema is introduced.
- **Department** *(existing entity, Spec 009)*: Referenced by each Training Need entry to determine
  ownership and visibility scope; its existing hierarchy drives Manager subtree access.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Department Manager can create and submit a training-need request in under 3 minutes on
  their first attempt.
- **SC-002**: 100% of submitted training-need entries are visible to HR/L&D Admins org-wide
  immediately, with no manual sync or export step.
- **SC-003**: A Department Manager viewing `/learning/tna` never sees another department's
  training-need entries outside their own hierarchy (zero cross-department visibility leaks).
- **SC-004**: An HR/L&D Admin can add a new custom field to the TNA form and see it appear on the next
  Manager's create form with no code deployment involved.
- **SC-005**: 90% of Managers successfully submit a complete training-need request without needing
  outside help or documentation.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: No change — follows the platform's existing shared-schema model
  with tenant scoping enforced server-side (Principle I); every training-need row is scoped by
  `tenant_id` and validated on every request, the same as Department and Team Directory records.
- **Tenant-configurable vs. fixed platform-wide**: Fixed platform-wide — the `training_needs_analysis`
  form type's existence, its minimal fixed system fields (title, priority, department, status), and
  the Draft/Submitted status model. Tenant-configurable — every data-collection field beyond that
  (e.g. Function, Type of Gap, Observable Incidences, Steps Taken, Performance Expectation, Affected
  Job Roles, Recommended Training) is added per-tenant via Settings > Forms (Spec 010,
  `forms.manage.tenant`), exactly as already configurable for Department — deliberately not
  hardcoded, per Constitution Principle III's explicit "TNA input fields" example.
- **AI-generation review/approval step**: N/A — this feature does not generate AI content.
- **Kirkpatrick L4/L5 data source & formula**: N/A — TNA captures training-need intake, not evaluation
  Results/ROI.
- **Downgrade/cancellation behavior**: N/A — not a security, budget, or evaluation module; standard
  tenant data-retention behavior applies.
- **Design system reference**: Reuses the established `@tm/ui` design system (locked per Spec 008) and
  the existing `AppShell`/`NavSection` sidebar pattern; no new design-system elements are introduced.
- **Demoable vs. internal**: Stakeholder-demoable — a Manager submitting a training need and an HR/L&D
  Admin viewing and configuring it end-to-end is directly showable.

## Assumptions

- No approve/reject workflow is in scope for v1. HR/L&D Admin oversight is limited to viewing,
  filtering, editing, and deleting submissions org-wide, not gating them through an explicit
  approval status. Per Constitution Principle VIII, this is flagged rather than silently assumed — if
  an approval step is actually wanted, that is a larger scope change to call out explicitly.
- TNA is not organized around HR-initiated recurring "cycles" or "campaigns" (e.g. a quarterly
  submission window) in v1. Managers can create a training-need entry at any time; each entry is
  independent. A cycle/campaign concept could be layered on top later without breaking this data
  model.
- Each training-need entry represents one discrete training need (one title/skill gap); a department
  accumulates a list of such entries over time rather than filling one consolidated multi-need form
  per period.
- Priority's value set (Low / Medium / High) is a reasonable default, not specified by the reference
  template (which had no priority column) or by the user; it is a fixed 3-level field rather than
  tenant-configurable because it needs to stay consistent for HR/L&D to sort and filter org-wide.
- The reference TNA template (Tincan Terminal Lagos) columns beyond title/priority — Function, Type of
  Gap, Observable Incidences, Steps Taken, Performance Expectation, Affected Job Roles, Recommended
  Training — are illustrative of what a real tenant's HR/L&D Admin configures via Settings > Forms
  (Story 3), not platform-hardcoded or Super-Admin-seeded global defaults, per Constitution Principle
  III. "Type of Gap" (tick-all-that-apply) maps onto the framework's existing multiselect field type.
- "Department Manager" scoping follows the same mechanism as Team Directory (Spec 012): derived from
  the submitting/viewing user's own `departmentId` (hierarchy-aware via the existing subtree logic),
  not `departments.manager_id`.
- The existing Custom Fields Framework (Spec 010) needs no schema changes beyond adding the
  `training_needs_analysis` row to `form_definitions` — `form_fields` and `custom_field_values` are
  reused as-is.
- New permission slugs (`tna.view.all`, `tna.view.department`, `tna.manage.all`,
  `tna.manage.department`) are added to the permission catalog and granted by default to the
  `hr_admin` role template (`tna.view.all` + `tna.manage.all`) and the `manager` role template
  (`tna.view.department` + `tna.manage.department`), following the same default-grant pattern as
  `team.view.all`/`team.view.department`.
