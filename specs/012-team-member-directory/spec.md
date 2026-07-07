# Feature Specification: Team Member Directory (List View)

**Feature Branch**: `012-team-member-directory`

**Created**: 2026-07-07

**Status**: Draft

**Input**: User description: "Generate a spec for the Team Member Directory (List View) in the TM (Total Man LMS) multi-tenant SaaS. A permission-scoped list/directory view of team members (org-wide via team.view.all vs. department-scoped via team.view.department vs. no access), showing core system fields (Name, Email, Role, Department, Account status) by default, with tenant-configured custom fields for the 'member' form type (per the existing Custom Fields Framework) available via an expandable row rather than hardcoded columns — informed by a real client staff-list sample (Prevoli) whose HR-specific fields (DOB, nationality, marital status, job title, grade level, etc.) must not be baked into the core schema. Includes server-side search, a hierarchy-aware department filter for org-wide viewers, and server-side pagination. Visual reference: a reference screenshot showing a search bar, bulk-select checkboxes, an avatar+name/position/department/email/phone/status/edit table, an expandable row revealing extra fields, and 'X of Y' pagination."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Org-wide admin browses the full team directory (Priority: P1)

An HR/L&D Admin (or any user holding `team.view.all`) opens "Members" and sees every team member across the whole tenant, regardless of department, with the core fields they need to identify each person at a glance: name, email, role, department, and account status. They can search by name or email to quickly find someone in a large org.

**Why this priority**: This is the baseline capability the whole feature exists for — without it, there is no directory at all. Every other story builds on this list existing and being correctly scoped.

**Independent Test**: Log in as a user holding `team.view.all`, open the Members screen, and confirm every member in the tenant appears (not just one department's), with the five core columns populated and search narrowing the list by name/email.

**Acceptance Scenarios**:

1. **Given** a tenant with members across three departments, **When** an org-wide viewer opens Members, **Then** members from all three departments appear in one list.
2. **Given** the org-wide viewer's list is open, **When** they type part of a member's name or email into the search box, **Then** the list narrows server-side to matching members only, still spanning every department.
3. **Given** an org-wide viewer, **When** the description line renders, **Then** it reads "View and manage everyone in your organization."

---

### User Story 2 - Department-scoped manager browses their own team (Priority: P2)

A Manager (or any user holding only `team.view.department`, not `team.view.all`) opens "Members" and sees only the members belonging to their own department or any of its descendant departments in the hierarchy — never members of unrelated departments, even via a crafted direct API request.

**Why this priority**: This is the feature's core security/scoping guarantee and the second most common real-world usage pattern (most viewers of a directory are department leads, not org-wide admins). It must be enforced correctly before this feature is safe to ship at all.

**Independent Test**: Seed two departments (with a parent/child relationship for one of them) with distinct members, log in as a manager scoped to one department, and confirm the returned list contains only that department's members and its descendants' members — confirmed both through the UI and a direct API call attempting to request an unrelated department's members.

**Acceptance Scenarios**:

1. **Given** a manager whose department has two child departments, **When** they open Members, **Then** members of their own department and both child departments appear, and no others.
2. **Given** a department-scoped manager, **When** the description line renders, **Then** it reads "View and manage members of your department."
3. **Given** a department-scoped manager, **When** they call the underlying members-list endpoint directly with a query parameter naming a department outside their own subtree, **Then** the server ignores or rejects the out-of-scope request and still returns only their own subtree's members (never a 200 with foreign data).
4. **Given** a department-scoped manager whose own department has zero currently-assigned members other than themselves, **When** they open Members, **Then** they still see themselves listed (a manager is always a member of their own department for this purpose) with an appropriate empty/near-empty state if that's the only entry.

---

### User Story 3 - Org-wide viewer filters the directory by department (Priority: P3)

An org-wide viewer narrows the directory to one department at a time using a department filter dropdown. Selecting a parent department shows that department's own direct members plus every member of its descendant departments, consistent with how Department's own hierarchy already works elsewhere in the product.

**Why this priority**: Valuable once the directory is being used at real scale (dozens+ members), but the directory is still useful without it — hence P3, not P1/P2.

**Independent Test**: Seed a parent department with two child departments and distinct members in each, select the parent in the filter dropdown, and confirm members from the parent and both children appear, while members from unrelated departments are excluded.

**Acceptance Scenarios**:

1. **Given** an org-wide viewer, **When** they open the department filter dropdown, **Then** every department in the tenant's hierarchy appears as an option.
2. **Given** a parent department with child departments, **When** the org-wide viewer selects the parent in the filter, **Then** members of the parent and all of its descendants appear, and members of unrelated departments do not.
3. **Given** a department-scoped (non-org-wide) viewer, **When** they open Members, **Then** no department filter control is shown at all.

---

### User Story 4 - Viewer clicks a row to see a member's full profile (Priority: P4)

Any viewer (org-wide or department-scoped) clicks anywhere on a member's row to open a slide-out profile panel showing that tenant's own configured custom fields for the "member" form type (whatever they are — this varies per tenant) alongside system metadata such as who invited this member and when. (Revised from an inline expandable row to a slide-out panel per direct product feedback — the panel gives a full member profile more room than an inline row disclosure.)

**Why this priority**: This is the feature's differentiator versus a bare list, and directly delivers on the spec's core constraint (no hardcoded HR fields), but the directory is functional and shippable without it, so it ranks below the baseline viewing/scoping stories.

**Independent Test**: As a tenant that has configured two custom fields on the "member" form type with values set for one member, click that member's row and confirm both custom field values render in the slide-out panel with their tenant-defined labels, alongside invited-by and invite-date metadata — with zero hardcoded field names anywhere in the response or the rendering code.

**Acceptance Scenarios**:

1. **Given** a tenant with no custom fields configured for "member," **When** a viewer clicks any row, **Then** the slide-out panel shows the member's core details and system metadata (invited-by, invite date) only, with no empty/broken custom-field placeholders.
2. **Given** a tenant with three custom fields configured for "member" and a member with values set for two of them, **When** a viewer clicks that member's row, **Then** the panel shows exactly those two fields with their configured labels and values, and the unset third field renders with the same empty-state treatment already established for Department's detail view (muted, descriptive placeholder text, not "—").
3. **Given** two different tenants with different custom fields configured for "member," **When** each tenant's viewer clicks a row, **Then** each sees only their own tenant's configured fields in the panel — never another tenant's field definitions or values.
4. **Given** the slide-out panel is open, **When** the viewer clicks its close control, clicks outside the panel, or presses Escape, **Then** the panel closes without navigating away from the directory.

---

### Edge Cases

- A user holding neither `team.view.all` nor `team.view.department`: the "Members" nav entry is hidden entirely, and a direct request to the underlying route returns 403 — never a 200 with an empty list (which would look like "zero members" rather than "no access").
- A department-scoped viewer whose own account currently has no department assigned (`department_id` is `NULL`): they see a distinct empty state explaining they aren't assigned to a department yet, not a generic "zero results" or a 500 error.
- Zero members match the current search text or department filter: a distinct "no matches" empty state, different from the "no permission" and "no department assigned" empty states.
- A member whose department has since been deleted/archived (if that's possible under Department Management's own rules) still appears in the directory with a clearly-labeled fallback rather than a blank or broken department cell.
- Pagination at the last page: "next" is disabled/hidden; at the first page, "previous" is disabled/hidden; the "X–Y of Z" label always reflects the currently-scoped total (i.e., a department-scoped viewer's "Z" is their subtree's count, never the tenant-wide count).
- Search text matches a member outside the current department filter selection: filtered-out results do not appear even if they match the search text (filter and search combine with AND, not OR).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a list view of team members reachable only by users holding `team.view.all` or `team.view.department`; users holding neither MUST NOT see the "Members" nav entry and MUST receive a 403 on direct route access.
- **FR-002**: For a user holding `team.view.all`, the list MUST include every member in the tenant regardless of department.
- **FR-003**: For a user holding `team.view.department` (and not `team.view.all`), the list MUST include only members whose department is the viewer's own department or a descendant of it in the department hierarchy, enforced by the server-side query itself — never by filtering a fully-fetched list on the client.
- **FR-004**: The list MUST display, for every member by default: Name (with avatar), Email, Role, Department, and Account status.
- **FR-005**: The list MUST NOT hardcode any tenant-specific HR field (e.g. date of birth, nationality, marital status, contact address, mobile number, education, contract type, job title, grade level) as a fixed schema column or fixed table column — any such field MUST be sourced exclusively through the existing Custom Fields Framework for the "member" form type.
- **FR-006**: Clicking a row MUST open a slide-out panel showing that member's full profile, including that tenant's currently-configured custom field values for that member (rendered dynamically — new tenant-configured fields must appear automatically with no code change) plus system metadata: who invited the member and when.
- **FR-007**: The description line under the "Team Members" heading MUST read "View and manage everyone in your organization." for `team.view.all` users and "View and manage members of your department." for `team.view.department`-only users.
- **FR-008**: System MUST provide server-side search by name and/or email, applied within the viewer's own visibility scope (a department-scoped viewer's search never surfaces members outside their subtree).
- **FR-009**: System MUST provide a department filter control, visible only to `team.view.all` users, listing every department in the tenant; selecting a department MUST include that department's direct members and every descendant department's members.
- **FR-010**: System MUST provide an "Add team member" action, shown only to users holding the permission that already gates team-member creation, routing to the existing/updated add-member flow.
- **FR-011**: System MUST gate Edit/Delete actions on each row by a team-management permission distinct from the view permission — holding only `team.view.all`/`team.view.department` MUST NOT expose Edit/Delete affordances.
- **FR-012**: System MUST paginate the list server-side, displaying a "X–Y of Z" indicator and next/previous controls, where Z always reflects the viewer's own visibility-scoped total.
- **FR-013**: System MUST render a distinct empty state for each of: no view permission, a department-scoped viewer with no department assigned, and zero members matching the current search/filter.
- **FR-014**: System MUST introduce the `team.view.all` and `team.view.department` permission keys (neither exists in the platform's permission catalog today) following the same catalog/role-template pattern used by every other module's permissions.

### Key Entities

- **Team Member (existing `users` row)**: represented in this view by its existing name, email, role assignment, and department assignment — no new fixed columns are added to this entity by this spec; any additional per-tenant attributes come from the existing custom-field-values entity, keyed to this user's id under the "member" form type.
- **Department (existing entity)**: supplies the hierarchy this spec's visibility scoping and filter dropdown both traverse — no changes to Department's own shape are needed.
- **Custom Field Definition & Value (existing entities, Custom Fields Framework)**: the source of every non-core field shown in a member's profile panel; this spec adds no new field-definition concept, only a new place (the member's profile panel) where that tenant's existing "member"-scoped field values are rendered.
- **Permission (existing entity)**: this spec adds two new catalog rows, `team.view.all` and `team.view.department`, granted to role templates following the existing pattern (e.g. `team.view.department` to the Manager template, mirroring its existing department-scoped analytics access; `team.view.all` to the HR/L&D Admin template).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An org-wide admin can locate a specific member by name or email, out of a directory of 100+ members, in under 10 seconds.
- **SC-002**: A department-scoped manager viewing the directory never sees a single member outside their own department subtree, verified across every tested department-hierarchy shape (flat, one level deep, two levels deep).
- **SC-003**: Adding a new tenant-configured custom field for "member" makes that field visible in every existing member's profile panel with zero code changes to the directory view itself.
- **SC-004**: A user without any team-viewing permission cannot retrieve any member data through the feature's underlying route under any input, verified by direct API testing, not just UI inspection.
- **SC-005**: Every one of the three distinct empty states (no permission, no department assigned, no results) is immediately understandable to a non-technical user without needing to ask what happened.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: Shared schema w/ RLS — no change. This view reads existing `users`, `departments`, `roles`, and custom-field tables, all already tenant-scoped via `request.tenantDb`; the new department-subtree visibility filter is an additional application-layer WHERE-clause narrowing on top of RLS's existing tenant boundary, not a replacement for it.
- **Tenant-configurable vs. fixed platform-wide**: The five core columns (Name, Email, Role, Department, Account status) are fixed platform-wide for every tenant — deliberately, since they map to attributes every tenant's member record already has regardless of industry. Every other displayed field is 100% tenant-configurable through the existing Custom Fields Framework; this spec introduces no new fixed HR-specific columns, per its own core constraint.
- **AI-generation review/approval step**: N/A — this feature generates no AI content.
- **Kirkpatrick L4/L5 data source & formula**: N/A — this feature does not touch Results/ROI evaluation.
- **Downgrade/cancellation behavior**: N/A — this is a directory/visibility feature, not a security, budget, or evaluation module in the sense the Quality Bar targets (no budget or Kirkpatrick data is read or written here).
- **Design system reference**: Reuses the established `packages/ui/src` primitives (Card, Badge, PageHeader, table patterns, portaled row-actions kebab menu, the `Drawer` slide-out panel already used by Department's own detail view) already used by Department's and Roles' own list screens — no new pattern is introduced beyond one new small `Pagination` primitive. The referenced screenshot's visual layout (search bar, avatar+name, status badges, "X of Y" pagination) is used as a content/structure reference, not a literal restyle away from TM's own established design system; its own expandable-row treatment was superseded by a slide-out panel per direct product feedback.
- **Demoable vs. internal**: Demoable — this is a stakeholder-facing screen a non-technical reviewer can click through directly.

## Assumptions

- **`team.view.all` and `team.view.department` do not exist yet.** A direct check of the current permission catalog (as of this spec, immediately after the Granular Permissions work) confirms Team/Members has only `manage_team_members` and `team.create` — no view-scoped permission exists at all today. This spec treats introducing these two keys as in-scope (visibility control is this spec's entire purpose), following the exact seed/grant/backfill migration pattern already established for every other module's permissions.
- **`team.view.department` is granted to the Manager role template by default**, mirroring Manager's existing department-scoped `view_department_analytics` grant — a manager who can already see their department's analytics is assumed to also reasonably need to see their department's member list. `team.view.all` is granted to the HR/L&D Admin template, matching its existing org-wide access to every other module.
- **Job Title / Position is a custom field, not a core column**, despite appearing as a fixed "Position" column in the reference screenshot. The written scope explicitly lists Job Title among the Prevoli-sample fields that must come from the Custom Fields Framework, not a hardcoded column — this spec follows the written scope over the reference image's literal column set where the two disagree, and treats the screenshot as a structural/interaction reference (search, avatar+name, status badges, "X of Y" pagination) rather than an exact column-for-column spec — its expandable-row interaction was itself superseded by a slide-out profile panel per direct product feedback.
- **Account status ("Invited / Active / Suspended") is read-only in this spec.** "Invited" is derived from the member never having completed their first login (mirrors the existing one-time-password onboarding flow); "Active" from having completed it. "Suspended" is displayed if/when the underlying capability to suspend a member exists, but the *action* of suspending, and any new schema field it requires, belongs to the companion Add/Edit Member spec (consistent with "editing member details" being explicitly out of scope here) — this spec only needs a value to display, not a mechanism to change it.
- **Bulk-select checkboxes are visual/structural only in this pass.** The reference screenshot shows row checkboxes and a "N Selected" indicator; this spec includes the checkbox column for visual/layout consistency with the reference, but defines no bulk action they enable — a future spec would define what selecting multiple members unlocks (e.g. bulk role reassignment), consistent with "Bulk import... not built here" being explicitly out of scope.
- **Default page size is 25 members per page**, a reasonable default consistent with this platform's other list screens (Department, Roles); adjustable in planning if a different number better matches real tenant sizes.
- **"UNIT" (from the Prevoli sample) mapping onto a child-level Department is an open question for the client, not assumed here** — per the user's own explicit instruction, this spec neither builds nor assumes any such mapping; if "Unit" data exists, it is expected to arrive as a custom field value like any other Prevoli-sample attribute until/unless a future spec formally maps it onto the department hierarchy.
- **Bulk import via CSV is out of scope**, flagged as a clear, expected future follow-on spec once this directory and the companion Add/Edit Member spec both exist, mirroring the Department CSV Import pattern referenced in the feature description.
