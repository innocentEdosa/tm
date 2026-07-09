# Quickstart: Add/Edit Team Member

Validation scenarios matching spec.md's user stories. All API calls assume a tenant session cookie
already established and use the contract in `contracts/add-edit-member-api.md`.

## Prerequisites

- A tenant with at least one custom role (beyond the system roles) and a department hierarchy two
  levels deep, with at least one department archived.
- Two custom fields configured for `formKey: "member"`, one marked required.
- A user holding `manage_team_members` (or `team.edit`) for the edit scenarios, and one holding only
  `team.view.all`/`team.view.department` (no edit) to verify the negative case.

## Scenario 1 — Create a member with the fixed Role picker and new Department field (User Story 1)

1. Open "Add member" from the Team Members directory; confirm it opens a slide-out drawer, not an
   inline page section.
2. Open the Role dropdown; confirm every tenant role (system and custom) appears, searchable by name.
3. Select a custom role and an Active department (confirm its full hierarchy path is shown, e.g.
   "Engineering > Backend"); confirm the archived department does not appear as an option at all.
4. Submit with a valid email; confirm `201` and that the created member's role/department match what
   was selected — never a raw id typed anywhere.
5. Repeat without selecting a department; confirm the member is created with no department assigned.

**Expected** (direct API check): `POST /tenant-auth/team` with a `roleId` that doesn't exist in this
tenant returns `422` with a clear message — not a `500`.

## Scenario 2 — Edit an existing member's role and department (User Story 2)

1. As an authorized admin, open an existing member's profile, click "Edit."
2. Confirm the form opens pre-filled with that member's current full name, role, department, and any
   custom field values — never blank.
3. Change the department to a different Active department; save; confirm the directory list and that
   member's own profile immediately reflect the new department.
4. Change the role to a different existing role; save; confirm the role updates.
5. As a user holding only a team-viewing permission (no `manage_team_members`/`team.edit`), open the
   same member's profile; confirm no "Edit" action is visible anywhere — not merely disabled.

**Expected** (direct API check): `PATCH /tenant/team/:userId` from the view-only user's session
returns `403`.

## Scenario 3 — Dynamic custom fields in create and edit (User Story 3)

1. As a tenant with two custom fields configured for "member" (one required), open the create form;
   confirm both fields render, in their configured order, below Full name/Email/Role/Department.
2. Submit without filling the required field; confirm submission is blocked with a field-level error
   identifying exactly that field — not a generic failure.
3. Fill both fields, submit, then open that member's edit form; confirm both values are pre-filled
   correctly.
4. As a tenant with zero custom fields configured for "member," confirm the create/edit form shows
   only the fixed fields — no broken placeholders.

## Scenario 4 — Validation is server-side, not just dropdown filtering

1. Directly call `POST /tenant-auth/team` (or `PATCH /tenant/team/:userId`) with a `departmentId`
   belonging to a *different* tenant, or an archived department's id; confirm `422` in both cases.
2. Directly call either route with a `roleId` that does not exist at all; confirm `422` with "Role
   not found" — not a `500`.

## Cleanup

Remove any test members, roles, or department reassignments created purely for this validation pass.
