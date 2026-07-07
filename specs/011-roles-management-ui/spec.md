# Feature Specification: Roles Management UI

**Feature Branch**: `011-roles-management-ui`

**Created**: 2026-07-06

**Status**: Draft

**Input**: User description: "Roles Management UI — a tenant-facing screen, built on the existing Roles & Permissions API (Spec 001), where a tenant admin can view system and custom roles together, create custom roles with a permission checklist grouped by category, edit a custom role (with an impact warning if it currently has assigned members), and delete a custom role (blocked while it has assigned members). System roles are read-only everywhere. The standalone 'Permission' sidebar item is removed; its function folds entirely into this Roles screen, which stays under Administration (not Settings) since roles are a people/access concern."

## Clarifications

### Session 2026-07-06

- Q: Should the system block a save that would leave the tenant with zero roles granting
  `manage_roles`, to prevent a tenant-wide role-management lockout? → A: No additional guardrail is
  needed. Every tenant's initially-provisioned admin is assigned a role derived from a platform role
  template (a system role) at provisioning time, and system roles can never be edited or have
  permissions removed from them (FR-004/FR-005) — only custom roles are editable. Since that system
  role's `manage_roles` grant is therefore permanent, editing or de-permissioning any number of
  custom roles can never leave the tenant without a `manage_roles`-capable role. That system role
  itself is the permanent safety net, not a new validation rule.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See every role at a glance (Priority: P1)

A user holding `manage_roles` opens Administration > Roles and sees every role in their tenant — both the built-in roles every tenant starts with and any custom roles their own admins have created — in one list, with each row showing how many people currently hold it and whether it's a system or custom role.

**Why this priority**: Without a single, trustworthy list, nothing else in this spec has anywhere to live — this is the foundation every other story builds on.

**Independent Test**: As a user holding `manage_roles`, open Administration > Roles and confirm every tenant role appears exactly once, with a visible "System" badge on built-in roles and an accurate member count per role.

**Acceptance Scenarios**:

1. **Given** a tenant with its default roles (from provisioning) plus at least one custom role, **When** the user opens Roles, **Then** all of them appear together in one list, each showing Role name, Description, Member count, and Type (System/Custom).
2. **Given** a system role, **When** the user looks at its row, **Then** it shows a "System" badge and its Edit/Delete controls are visibly disabled with a tooltip explaining "System roles cannot be modified."
3. **Given** a custom role, **When** the user looks at its row, **Then** its Edit/Delete controls are active.

---

### User Story 2 - Create a custom role with specific permissions (Priority: P1)

A user holding `manage_roles` clicks "Create role," names it, optionally describes it, checks the specific permissions it should grant — organized by module so a long list stays navigable — and saves it, making it immediately available to assign to members.

**Why this priority**: This is the entire value proposition of the screen — without it, tenants are stuck with exactly the four default roles forever, unable to model their own organization's access needs.

**Independent Test**: As a user holding `manage_roles`, create a role named "Content Reviewer" with only `edit_content_library` checked, save, and confirm it appears in the list as Custom with that one permission — independent of any edit/delete flow.

**Acceptance Scenarios**:

1. **Given** the Create role form, **When** the user submits a name and at least selects permissions, **Then** the role is created with exactly the checked permissions and appears in the list immediately, with a member count of 0.
2. **Given** the permission checklist, **When** it renders, **Then** every permission from the platform's permission catalog appears, grouped by its category, each showing its display name and description — with no permission group hardcoded into the screen itself.
3. **Given** a permission group with multiple items, **When** the user clicks that group's "select all," **Then** every permission in that group (and only that group) becomes checked; the group can also be collapsed/expanded.
4. **Given** a role name that already exists in this tenant, **When** the user submits, **Then** the save is rejected with a clear inline message (surfaced from the server's own uniqueness check, not a frontend-only guess).

---

### User Story 3 - Edit a custom role, with a clear warning if people are already using it (Priority: P2)

A user holding `manage_roles` renames a custom role or changes its permission set. If nobody currently holds that role, the change saves immediately. If people do, the user sees an explicit warning that the change takes effect for all of them right away, and must confirm before it's applied.

**Why this priority**: Protects real people's access from silent, surprising changes — but only matters once roles from User Story 2 actually have members assigned, so it's P2.

**Independent Test**: Edit a custom role with zero members and confirm it saves with no dialog; separately, assign a member to a custom role, edit that role's permissions, and confirm the impact-warning dialog appears and blocks saving until confirmed.

**Acceptance Scenarios**:

1. **Given** a custom role with 0 assigned members, **When** the user edits and saves it, **Then** it saves immediately with no confirmation dialog.
2. **Given** a custom role with N ≥ 1 assigned members, **When** the user edits and clicks save, **Then** a confirmation dialog appears stating the change affects N member(s) immediately, and the save only proceeds if the user confirms; clicking Cancel returns to the edit form with nothing saved.
3. **Given** the edit form for a custom role, **When** it opens, **Then** it's pre-filled with that role's current name, description, and checked permissions.

---

### User Story 4 - Delete a custom role that's no longer needed (Priority: P2)

A user holding `manage_roles` removes a custom role. If it still has members assigned, the deletion is blocked with a clear explanation and a direct link to go reassign those members first; once nobody holds it, deletion succeeds immediately.

**Why this priority**: Protects data integrity (nobody left without a role) — depends on roles and assignments from Stories 2-3 existing, so it's P2.

**Independent Test**: Attempt to delete a custom role with assigned members and confirm it's blocked with the member count and a working link toward the Members list; delete a custom role with zero members and confirm it's removed immediately.

**Acceptance Scenarios**:

1. **Given** a custom role with N ≥ 1 assigned members, **When** the user attempts to delete it, **Then** the deletion is blocked with the message "This role is assigned to N member(s). Reassign them to a different role before deleting," alongside a link toward the Members list.
2. **Given** a custom role with 0 assigned members, **When** the user deletes it, **Then** it is removed immediately and no longer appears in the list.
3. **Given** a system role, **When** the user looks for a delete action, **Then** none exists anywhere in the UI.

---

### User Story 5 - "Permission" disappears as its own nav item (Priority: P3)

Anyone who used to look for a separate "Permission" entry in the sidebar now finds everything they need inside Roles; the standalone nav item is gone.

**Why this priority**: Pure information-architecture cleanup — valuable so the sidebar doesn't carry a placeholder that no longer means anything, but it doesn't block Stories 1-4's actual functionality, so it's lowest priority.

**Independent Test**: Open the sidebar as a user holding `manage_roles` and confirm "Roles" is present and functional under Administration, while no "Permission" entry exists anywhere.

**Acceptance Scenarios**:

1. **Given** the sidebar, **When** it renders for a user holding `manage_roles`, **Then** "Roles" appears under Administration as an active link (not a disabled "Soon" placeholder) and no "Permission" entry appears anywhere.
2. **Given** a user who does *not* hold `manage_roles`, **When** the sidebar renders, **Then** neither "Roles" nor "Permission" appears — consistent with how other Administration entries are already gated by their own governing permission.

---

### Edge Cases

- What happens when a user without `manage_roles` navigates directly to the Roles URL? Rejected (403), consistent with how every other permission-gated tenant screen already behaves — no new pattern introduced.
- What happens if two admins edit the same role at the same time? Last write wins, consistent with how Department and every other tenant-scoped edit in this codebase already behaves today — no new optimistic-locking behavior is introduced here.
- What happens if a role's last remaining permission is unchecked, leaving it with zero permissions? Allowed — a role with zero permissions is valid (mirrors the existing `employee` default template, which already ships with zero permissions).
- What happens when the permission catalog is empty or a category has no permissions (hypothetically)? The group section simply doesn't render — never an empty, confusing group header.
- What happens to a role's already-assigned members if the role is edited to remove all permissions? They keep the role, now with fewer permissions — consistent with User Story 3's "changes take effect immediately" framing; no separate confirmation beyond the one impact-warning dialog already specified.
- What happens if the user tries to edit or delete a system role via a direct API call, not just the UI? Rejected server-side — the protection must not be a UI-only illusion (see FR-011).
- What happens if editing custom roles' permissions would leave the tenant with no `manage_roles`-capable role anywhere? This cannot actually happen: the tenant's initially-provisioned admin always holds a system-role-derived role, which can never be edited (FR-004/FR-005), so a `manage_roles` grant always survives regardless of how any custom role is edited — no separate lockout guardrail is needed (Clarifications).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display every role belonging to the tenant — both roles derived from a platform role template (system roles) and roles the tenant created itself (custom roles) — in one combined list.
- **FR-002**: System MUST show, for each role: name, description, current member count, and whether it is System or Custom.
- **FR-003**: System MUST visually distinguish system roles (e.g. a "System" badge) from custom roles wherever both appear together.
- **FR-004**: System MUST NOT expose any Edit or Delete action for a system role anywhere in the UI; the corresponding controls render disabled with a tooltip explaining "System roles cannot be modified."
- **FR-005**: System MUST reject any attempt to edit or delete a system role even via a direct API call, not only hide the option in the UI (a system role is defined as one whose `source_template_id` is not null — see Assumptions).
- **FR-006**: System MUST let a user holding `manage_roles` create a custom role with a name (required) and description (optional).
- **FR-007**: System MUST let a user holding `manage_roles` select any combination of platform permissions for a custom role, presented as a checklist grouped by each permission's category, with every group's items collapsible and a "select all in group" action.
- **FR-008**: The permission checklist MUST be generated from the platform's actual permission catalog at render time — adding a new permission on the backend must make it appear here with no frontend code change.
- **FR-009**: System MUST let a user holding `manage_roles` edit a custom role's name, description, and permission set.
- **FR-010**: System MUST show a confirmation dialog before saving an edit to a custom role that currently has one or more assigned members, stating the exact member count and that the change takes effect immediately; the save proceeds only on explicit confirmation, and is fully cancellable with nothing saved.
- **FR-011**: System MUST NOT show the confirmation dialog described in FR-010 when editing a custom role with zero assigned members — the save proceeds immediately.
- **FR-012**: System MUST let a user holding `manage_roles` delete a custom role, but only when it has zero assigned members.
- **FR-013**: System MUST block deletion of a custom role with one or more assigned members, showing the exact member count and a link toward the Members list as a next step.
- **FR-014**: System MUST surface the server's own validation results (e.g. duplicate role name) rather than only relying on frontend-side checks — frontend validation exists to give faster feedback, not to replace server enforcement.
- **FR-015**: System MUST gate visibility of the Roles nav entry and every action on this screen by the `manage_roles` permission — the same key that already governs role mutations in the existing API, not a newly invented key.
- **FR-016**: System MUST remove the standalone "Permission" sidebar entry entirely; every capability it previously represented is available from within Roles.
- **FR-017**: System MUST continue to place "Roles" under the existing "Administration" sidebar section, unchanged in position relative to Members and Department.

### Key Entities

- **Role**: A named, tenant-scoped set of permissions a member can hold. Already modeled by the existing Roles & Permissions API (Spec 001) — this spec adds no new columns, only a UI and the minimum new read endpoints needed to power it (see Assumptions). Distinguishes System (derived from a platform role template) from Custom (created by this tenant).
- **Permission**: A single platform capability (e.g. `department.manage`), already modeled and cataloged by the existing API, each belonging to a category used purely for grouping in this UI.
- **Role Assignment**: The existing link between a member and the role(s) they hold — this spec reads its count per role but does not change how assignment itself works (single-member assignment via the Members/invite flow is explicitly out of scope here).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A tenant admin can create a custom role with a specific permission set and see it ready to assign in under a minute, with no engineering involvement.
- **SC-002**: 100% of attempts — via the UI or a direct API call — to edit or delete a system role are rejected.
- **SC-003**: 100% of edits to a custom role with assigned members show the impact-warning dialog before saving; 0% of edits to a role with zero assigned members show it.
- **SC-004**: 100% of attempts to delete a custom role with assigned members are blocked with an accurate member count and a working link toward the Members list.
- **SC-005**: A permission added to the catalog by any future module appears in the Create/Edit checklist with zero changes to this screen's own code.
- **SC-006**: No "Permission" entry exists anywhere in the sidebar after this ships, for any user.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: Shared schema with RLS — no change. This screen reads and writes exclusively through `request.tenantDb`, exactly like the existing role-mutation routes it's built on; the two new read endpoints this spec needs (role list with member counts, tenant-facing permission catalog) follow the identical RLS-scoped pattern, not a new isolation mechanism.
- **Tenant-configurable vs. fixed platform-wide**: The permission catalog itself (which keys exist, what they mean) is fixed platform-wide, seeded per module as each ships — this spec never lets a tenant invent a new permission key. Which roles exist and which permissions each custom role grants is fully tenant-configurable. System roles' own permission sets are fixed (owned by their originating role template), reinforcing Principle III's existing split rather than changing it.
- **AI-generation review/approval step**: N/A — no AI-generated content.
- **Kirkpatrick L4/L5 data source & formula**: N/A — this spec manages access control, not Results/ROI data.
- **Downgrade/cancellation behavior**: N/A — generic access-management infrastructure, not a security, budget, or evaluation module in the sense Principle covers.
- **Design system reference**: Uses the established Desktop Shell Visual Language design system — reuses `Card`/`Badge`/`Drawer`/`Modal`/`Button`/`Input` from `packages/ui` and the row-actions kebab-menu pattern already established for Department Management (Spec 009), not a new pattern.
- **Demoable vs. internal**: Demoable — a tenant admin creating a custom role, assigning it real permissions, and seeing the impact-warning dialog fire when editing a role with members is a complete, visible, end-to-end flow.

## Assumptions

- **Two new read endpoints are required and don't exist yet.** The existing API (Spec 001) only ever implemented `POST`/`PATCH`/`DELETE /tenant/roles/:roleId` — there is no endpoint today that lists a tenant's roles, and no tenant-facing endpoint that returns the permission catalog (the only existing catalog read, `GET /admin/permissions`, is Super-Admin-only and platform-wide, not tenant-scoped). This spec's UI cannot function without: (1) a `GET /tenant/roles`-shaped endpoint returning each role's id, name, description, permission keys, whether it's a system role, and its current member count, and (2) a tenant-facing, `manage_roles`-gated endpoint returning the permission catalog grouped by category. Both are treated as necessary supporting additions to the existing API, not a re-specification of its data model.
- **"System role" = a role whose `source_template_id` is not null.** The existing `roles` table already tracks this via `sourceTemplateId` (populated when a tenant's default roles are provisioned from a platform role template), but nothing today actually enforces immutability from it — every tenant's four default roles (`hr_admin`, `manager`, `employee`, plus the platform-only `super_admin`) are otherwise ordinary, editable/deletable rows. This spec introduces the first real enforcement of that distinction, reusing the existing column rather than adding a new flag.
- **`manage_roles` alone gates the whole screen** — view and manage together, no separate view-only permission — consistent with how the Settings > Forms screen (Extensible Custom Fields Framework) already gates its whole screen by a single manage-level permission rather than splitting view/manage.
- **The "link toward the Members list" does not filter it.** Department's own blocked-delete response already links to `/settings/team?department=<id>`, but the Members list doesn't actually read that query param today — it's an unfiltered link. This spec's role-based equivalent (`/settings/team?role=<id>` or similar) follows the exact same, already-established pattern for consistency; actually implementing member-list filtering is a pre-existing gap shared with Department, not something newly introduced or fixed here.
- Permission categories in the catalog today (`roles`, `platform`, `enrollment`, `content`, `analytics`, `settings`, `department`, `forms`) are what the grouped checklist will show at launch — the exact set is expected to grow as future modules (e.g. TNA) ship their own permissions, which is precisely why grouping is driven by the catalog's own `category` field rather than a hardcoded list.
- Existing permission-key naming is inconsistent (`manage_roles` vs. dotted keys like `department.view`) — this spec displays whatever the catalog returns as-is and does not attempt to normalize or rename existing keys.
- Single-member role assignment (via the Members/invite flow) already exists and is unchanged by this spec; bulk reassignment of multiple members at once is out of scope.
