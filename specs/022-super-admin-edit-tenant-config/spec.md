# Feature Specification: Super Admin Edit Tenant Configuration

**Feature Branch**: `022-super-admin-edit-tenant-config`

**Created**: 2026-07-17

**Status**: Draft

**Input**: User description: "Extend the Super Admin Tenant Console (Spec 020) so a Super Admin has
the same configuration-editing ability inside any tenant that a tenant HR/admin already has for
their own tenant — not just viewing and password-reset (Spec 020) or adding a member (Spec 021).
This formally reverses Spec 020's FR-014 (\"The console MUST NOT provide the ability to edit
members, roles, or departments\") and updates Spec 021's FR-011, which reaffirmed that restriction
for members specifically — both are now superseded by this spec, not violated by it. Spec 020's
FR-015 (no \"view as member\" / session-swap impersonation) is NOT touched and stays fully in force:
every write below is still performed and attributed as the Super Admin's own identity, never as the
member/tenant, exactly as Spec 020/021's existing `member_action_log` pattern already does. Four
write surfaces are added, each a thin `request.superAdminDb`-scoped wrapper around the exact
existing tenant-side mechanism — same validation order, same business rules, same error cases — with
an explicit `tenant_id` filter on every lookup (never inferred from ambient RLS context, per Spec
020's research.md §1 lesson, reused again in Spec 021): (1) Edit an existing member's full name,
role, department, and archived status, mirroring `PATCH /tenant/team/:userId` (Spec 013,
`apps/api/src/tenant-auth/tenant-team-routes.ts`) exactly, including the department-leader
archive-block (`isDepartmentLeader`) — reuse Spec 021's `roleExistsForTenant`/tenant-scoped
department-active helpers rather than reinventing them; (2) Create, edit, and delete a tenant's own
roles and their permission assignments, mirroring `POST`/`PATCH`/`DELETE /tenant/roles(/:roleId)`
(Spec 011, `apps/api/src/permissions/tenant-role-routes.ts`) exactly, including the system-role
protection (a role with a non-null `sourceTemplateId` can never be edited or deleted, by anyone,
Super Admin included) and the \"role has members assigned\" delete-conflict guard — and explicitly
excluding the single platform-wide Super Admin role row (`tenant_id IS NULL`), which this
tenant-scoped mechanism must never be able to reach; (3) Create and edit a tenant's departments
(name, description, parent department, status, Manager/Assistant Manager), mirroring
`POST`/`PATCH /tenant/departments` (Spec 009) exactly, including the 3-level hierarchy cap and
case-insensitive per-tenant name uniqueness; (4) Create, edit, and archive a tenant's own custom
field definitions per registered form type, mirroring `POST`/`PATCH /tenant/custom-fields`
(Spec 010) exactly, attributing rows created this way with `createdBy: \"super_admin\"` — a value
the schema's check constraint already permits, but which today is reserved for Spec 010 FR-002's
not-yet-built global field-authoring screen; this spec is the first to exercise `super_admin` as
`createdBy` for a tenant-scoped field, which FR-002 never covered. RLS: `roles`, `role_permissions`,
`departments` already carry unrestricted `super_admin_full_access` policies (migrations 0059-0061)
permitting INSERT/UPDATE/DELETE — confirm this the way Spec 021 confirmed it for `users`/`user_roles`.
`form_fields` has NO such policy today — a Super Admin session gets zero rows there — so surface (4)
requires a new additive migration before it can work. Every write on all four surfaces MUST be
logged to `member_action_log` with new action values, the same accountability mechanism Spec
020/021 already use. Consistent with Spec 020 FR-013/021 FR-010, all four surfaces MUST remain
available regardless of tenant status unless decided otherwise. Out of scope: the platform-wide
Super Admin role; field reordering unless pulled in; bulk/CSV import; resend/revoke invite (doesn't
exist per Spec 012); tenant status changes (Spec 015); any impersonation (FR-015 stays intact)."

## Clarifications

### Session 2026-07-17

- Q: The existing `member_action_log` table is shaped specifically around a member
  (`tenantId`/`memberId`/`superAdminId`/`action`/`createdAt`) — a role, department, or custom-field
  edit doesn't target a member, so it doesn't fit that table as-is. How should role/department/
  custom-field edits be logged? → A: Add a new, parallel `tenant_config_action_log` table
  (`tenantId`, `superAdminId`, `entityType`, `entityId`, `action`, `createdAt`), keeping
  `member_action_log` purely member-scoped.
- Q: The tenant-side role-edit route sits behind a permission catalog that deliberately excludes the
  `platform` category (keys only ever checked by Super-Admin-session routes, meaningless on a tenant
  role). Should the Super Admin role-edit surface reuse that same filtered catalog, or expose the
  full catalog? → A: Reuse the exact same filtered catalog — `platform`-category permissions remain
  unassignable to any tenant role, from either the tenant side or this console.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Edit an Existing Member's Role, Department, and Status (Priority: P1)

As a Super Admin, from a tenant's Members tab inside the console, I can edit an existing member's
full name, role, department, custom field values, and archived status — the same fields a tenant
admin can already edit from their own Team Directory — so I can correct or update a member's record
on a tenant's behalf without needing that tenant's own admin to do it.

**Why this priority**: This is the capability most directly requested — reversing Spec 020's FR-014
restriction on member edits, the gap most likely to block day-to-day support work.

**Independent Test**: From the console's Members tab, open an existing member, change their role and
department, save, and confirm the change is reflected immediately in that tenant's own Team
Directory — independent of any other capability in this spec.

**Acceptance Scenarios**:

1. **Given** a tenant open in the console with an existing member, **When** a Super Admin changes
   that member's role to another role belonging to the same tenant and saves, **Then** the member's
   role is updated and reflected immediately in both the console and that tenant's own Team
   Directory.
2. **Given** the member edit form, **When** a Super Admin submits a role or department that does not
   belong to the tenant being edited, **Then** the system rejects the submission with a clear message
   and makes no change.
3. **Given** a member who is currently a department's Manager or Assistant Manager, **When** a Super
   Admin attempts to archive that member, **Then** the system rejects the action with the same
   "reassign that leadership role first" message the tenant-side mechanism already gives.
4. **Given** a member was edited through this console, **When** platform records are later checked,
   **Then** who made the change, to which member, and when, is recoverable via the existing action
   log mechanism.

---

### User Story 2 - Create, Edit, and Delete a Tenant's Roles (Priority: P2)

As a Super Admin, from a tenant's Roles view inside the console, I can create a new role, edit an
existing custom role's name, description, and permission assignments, or delete a custom role with
no members assigned — the same actions a tenant admin can already take from their own Roles &
Permissions screen — so I can configure a tenant's role structure to match what they need.

**Why this priority**: Roles gate almost everything else a member can do in the product, so getting
this right for a tenant is usually the first configuration step after onboarding.

**Independent Test**: From the console's Roles view for a tenant, create a new role with a chosen set
of permissions, confirm it appears and is assignable to a member, then edit its permission set and
confirm the change takes effect — independent of any other capability in this spec.

**Acceptance Scenarios**:

1. **Given** a tenant open in the console, **When** a Super Admin creates a new role with a name and
   a set of permissions, **Then** the role is created for that tenant and immediately available to
   assign to a member.
2. **Given** an existing custom (non-system) role, **When** a Super Admin edits its name, description,
   or permission set, **Then** the change is saved and reflected immediately in that tenant's own
   Roles & Permissions screen.
3. **Given** a system role (derived from a platform role template), **When** a Super Admin attempts
   to edit or delete it, **Then** the system rejects the action with the same "System roles cannot be
   modified" message the tenant-side mechanism already gives — even via a direct API call.
4. **Given** a custom role with at least one member assigned, **When** a Super Admin attempts to
   delete it, **Then** the system rejects the deletion with a "reassign members first" message and
   deletes nothing.
5. **Given** any tenant's role, **When** a Super Admin attempts to view or edit the single
   platform-wide Super Admin role, **Then** the system never surfaces or permits that row through this
   tenant-scoped mechanism.

---

### User Story 3 - Create and Edit a Tenant's Departments (Priority: P3)

As a Super Admin, from a tenant's Departments view inside the console, I can create a new department
or edit an existing one's name, description, parent department, status, and Manager/Assistant
Manager — the same actions a tenant admin can already take from their own Department Management
screen — so I can configure a tenant's org structure to match what they need.

**Why this priority**: Org structure is typically configured once per tenant early on, and less
frequently touched afterward than member or role data — still a real onboarding-support need, but
lower-frequency than Stories 1-2.

**Independent Test**: From the console's Departments view for a tenant, create a new department,
assign it a parent, then edit its Manager, and confirm both changes are reflected immediately in
that tenant's own Department Management screen — independent of any other capability in this spec.

**Acceptance Scenarios**:

1. **Given** a tenant open in the console, **When** a Super Admin creates a new department with a
   name, **Then** the department is created for that tenant and immediately visible in both the
   console and that tenant's own screen.
2. **Given** an existing department, **When** a Super Admin edits its name, description, parent
   department, status, or Manager/Assistant Manager, **Then** the change is saved and reflected
   immediately in that tenant's own screen.
3. **Given** a department nesting that would exceed the existing 3-level hierarchy cap, **When** a
   Super Admin attempts to save that parent assignment, **Then** the system rejects it with the same
   message the tenant-side mechanism already gives.
4. **Given** a department name that already exists for that tenant (case-insensitive), **When** a
   Super Admin attempts to create or rename a department to that name, **Then** the system rejects
   the submission and creates or changes nothing.

---

### User Story 4 - Create, Edit, and Archive a Tenant's Custom Field Definitions (Priority: P4)

As a Super Admin, from a tenant's Forms view inside the console, I can add a new custom field to one
of that tenant's forms (e.g. Member, Department), edit an existing tenant-owned field's label, type,
options, or required flag, or archive a field that already has stored values — the same actions a
tenant admin can already take from their own Forms settings — so I can configure a tenant's intake
forms to match what they need.

**Why this priority**: Lowest frequency of the four surfaces in practice, and the one with the
smallest existing platform footprint (no Super Admin RLS access exists for this table today) — most
appropriate to build and verify last.

**Independent Test**: From the console's Forms view for a tenant, add a new custom field to the
Member form, confirm it renders on that tenant's own member form, then archive it and confirm it
disappears from new submissions while previously stored values are preserved — independent of any
other capability in this spec.

**Acceptance Scenarios**:

1. **Given** a tenant open in the console, **When** a Super Admin adds a new field to one of that
   tenant's registered form types, **Then** the field is created scoped to that tenant only and
   appears on that tenant's own form immediately.
2. **Given** an existing tenant-owned field, **When** a Super Admin edits its label, type, options, or
   required flag, **Then** the change is saved and reflected immediately on that tenant's own form.
3. **Given** a field key that collides with an existing global or that tenant's own field key for the
   same form type, **When** a Super Admin attempts to create it, **Then** the system rejects the
   submission with the same uniqueness message the tenant-side mechanism already gives.
4. **Given** a tenant-owned field that already has at least one stored value, **When** a Super Admin
   archives it, **Then** the field disappears from future form renders but every previously stored
   value remains unmodified and unremoved.
5. **Given** a global (platform-wide) field, **When** a Super Admin attempts to edit or archive it
   through this tenant-scoped mechanism, **Then** the system rejects the action — global fields remain
   editable only through Spec 010's own not-yet-built authoring screen, never through this console.

---

### Edge Cases

- What happens if a Super Admin tries to edit or delete a system role? Rejected with the same message
  a tenant admin would see, even via a direct API call — no Super Admin bypass exists.
- What happens if a Super Admin tries to archive a member who is currently a department's Manager or
  Assistant Manager? Rejected with the same "reassign that leadership role first" message the
  tenant-side mechanism already gives.
- What happens if a Super Admin submits a department parent that would exceed the 3-level hierarchy
  cap? Rejected, same as the tenant-side mechanism.
- What happens if a Super Admin submits a custom field key that collides with an existing global or
  tenant field key for that form type? Rejected, same as the tenant-side uniqueness rule.
- What happens if two Super Admins (or a Super Admin and a tenant admin) edit the same record at the
  same time? Last write wins — the existing tenant-side mechanism's own concurrency behavior is
  reused unchanged; this spec introduces no new locking.
- What happens if a Super Admin attempts to reach the single platform-wide Super Admin role, or a
  global (platform-wide) custom field, through any of these tenant-scoped routes? Rejected — neither
  is reachable through this mechanism under any tenant id.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: This feature formally reverses Spec 020's FR-014 and supersedes Spec 021's FR-011 — the
  console MUST now provide the ability to edit members, roles, and departments, and to edit/create
  custom field definitions, exactly as described below.
- **FR-002**: Spec 020's FR-015 (no impersonation / session-swap) MUST remain fully in force —
  nothing in this feature introduces a "view as member" mode; every write is performed and attributed
  as the Super Admin's own identity.
- **FR-003**: The console MUST allow a Super Admin to edit an existing member's full name, role,
  department, custom field values, and archived status, for any tenant, mirroring
  `PATCH /tenant/team/:userId`'s (Spec 013) exact validation order and rules, including rejecting a
  role or department that does not belong to the tenant being edited, and blocking archival of a
  member who is currently a department Manager or Assistant Manager.
- **FR-004**: The console MUST allow a Super Admin to create a new role for any tenant, and to edit
  or delete an existing custom (non-system) role's name, description, and permission assignments,
  mirroring `POST`/`PATCH`/`DELETE /tenant/roles(/:roleId)`'s (Spec 011) exact validation order and
  rules. Permission assignment MUST draw only from the same tenant-facing permission catalog the
  tenant-side route already exposes (excluding the `platform` category) — a `platform`-category
  permission MUST NOT be assignable to a tenant role through this console either.
- **FR-005**: The system MUST reject any attempt — through this console — to edit or delete a system
  role (a role with a non-null `sourceTemplateId`), or to delete a role with at least one member
  still assigned, using the same messages the tenant-side mechanism already gives.
- **FR-006**: The system MUST NOT expose or permit any write to the single platform-wide Super Admin
  role (`tenant_id IS NULL`) through this tenant-scoped mechanism, under any tenant id.
- **FR-007**: The console MUST allow a Super Admin to create a new department for any tenant, and to
  edit an existing department's name, description, parent department, status, and Manager/Assistant
  Manager, mirroring `POST`/`PATCH /tenant/departments`'s (Spec 009) exact validation order and
  rules, including the 3-level hierarchy cap and case-insensitive per-tenant name uniqueness.
- **FR-008**: The console MUST allow a Super Admin to create a new custom field definition scoped to
  a specific tenant, and to edit or archive an existing tenant-owned field definition, for any
  registered form type, mirroring `POST`/`PATCH /tenant/custom-fields`'s (Spec 010) exact validation
  order and rules, including per-form-type field-key uniqueness across global and tenant field sets.
- **FR-009**: A custom field definition created through this console MUST be recorded with
  `createdBy: "super_admin"` and scoped with the target tenant's own `tenant_id` (never
  `tenant_id IS NULL`); the system MUST NOT allow this console to edit or archive a global
  (`tenant_id IS NULL`) field — those remain reachable only through Spec 010's own not-yet-built
  global authoring screen. (Correction during planning: `form_fields` already carries a
  `super_admin_full_access` RLS policy and full `tm_app` grants, added in Spec 010's own migrations
  0028/0029 for this not-yet-built screen — so this restriction must be enforced by this feature's
  own query logic, not by RLS, which would otherwise permit a Super Admin session to reach a global
  row.)
- **FR-010**: The system MUST record every edit to an existing member (this feature's member-edit
  surface) to the existing `member_action_log` table, exactly as Spec 020/021 already do. The system
  MUST record every create, edit, or delete on a role, department, or custom field definition to a
  new, parallel `tenant_config_action_log` table, at minimum capturing which Super Admin, which
  tenant, which record, and when — even though no dedicated audit-log screen is in scope for this
  spec.
- **FR-011**: All routes underlying this feature MUST be restricted to Super Admin sessions, using the
  same guard applied to every other Super-Admin-only route today; any other caller MUST be rejected.
- **FR-012**: All four write surfaces MUST remain fully available for a tenant in any status (Active,
  Trial, Archived, Suspended, or Pending-Deletion), consistent with Spec 020 FR-013 / Spec 021
  FR-010's precedent; tenant status MUST NOT gate any of these actions.
- **FR-013**: This feature MUST NOT introduce any new hard-delete capability beyond what already
  exists tenant-side: departments remain create/edit/status-only (no delete), matching the existing
  tenant-side department mechanism exactly.
- **FR-014**: This feature MUST NOT introduce a way to reorder custom fields
  (`form_field_order_overrides`), bulk/CSV-import records, resend or revoke a member invite, or
  change a tenant's own status (Active/Trial/Archived/Suspended/Pending-Deletion) — all remain out of
  scope, per the feature description's own explicit exclusions.

### Key Entities *(include if feature involves data)*

- **Member**: The existing tenant-scoped user record (Specs 002/012/013); this feature adds one more
  way to update a row in it (role, department, custom field values, archived status) — the record
  itself gains no new fields.
- **Role**: The existing tenant-scoped role record (Spec 001/011); this feature adds Super-Admin
  create/edit/delete access, subject to the same system-role protection tenant admins already have.
- **Department**: The existing tenant-scoped department record (Spec 009); this feature adds
  Super-Admin create/edit access, subject to the same hierarchy and uniqueness rules tenant admins
  already have.
- **Custom Field Definition**: The existing `form_fields` record (Spec 010); this feature adds
  Super-Admin create/edit/archive access scoped to one tenant's own field set, distinct from Spec
  010's still-unbuilt global authoring screen.
- **Member Action Log Entry**: Existing platform-level audit record introduced by Spec 020, scoped to
  member actions only; this feature adds one new recorded action value for member edits, alongside
  its existing `"password_reset"` and `"member_added"` values — no new table or column.
- **Tenant Config Action Log Entry**: New platform-level, append-only audit record
  (`tenant_config_action_log`) parallel to `member_action_log`'s shape (tenant, Super Admin, entity
  type, entity id, action, timestamp), covering role/department/custom-field creates, edits, and
  deletes — kept separate from `member_action_log` per this spec's Clarifications, since those
  actions don't target a member.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Super Admin can edit an existing member's role, department, or status for any tenant,
  from that tenant's console, in under one minute.
- **SC-002**: A Super Admin can create or edit a tenant's roles — including permission assignments —
  achieving the same outcome that tenant's own admin could achieve from their own Roles screen.
- **SC-003**: A Super Admin can create or edit a tenant's departments, achieving the same outcome that
  tenant's own admin could achieve from their own Department Management screen.
- **SC-004**: A Super Admin can create, edit, or archive a tenant's own custom field definitions,
  achieving the same outcome that tenant's own admin could achieve from their own Forms settings.
- **SC-005**: 100% of edits performed through this feature's four write surfaces are traceable
  afterward to a specific Super Admin, tenant, and record.
- **SC-006**: 100% of attempts to edit or delete a system-protected record (a system role, the
  platform-wide Super Admin role, a global custom field) through this console are rejected, with zero
  exceptions.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: Shared schema w/ RLS — extends the model Spec 020 established.
  `roles`, `role_permissions`, and `departments` already carry unrestricted `super_admin_full_access`
  policies (migrations 0059-0061) that permit INSERT/UPDATE/DELETE, confirmed by inspection — no new
  migration needed there. `form_fields` also already carries a `super_admin_full_access` policy and
  full `tm_app` grants (migrations 0028/0029, added ahead of time for Spec 010 FR-002's not-yet-built
  global authoring screen) — confirmed by inspection, correcting this spec's own earlier Input/
  Assumptions text, which incorrectly assumed no such policy existed. No new RLS or grant migration
  is needed for any of the four write surfaces; FR-009's global-field exclusion (never
  `tenant_id IS NULL`) must instead be enforced by this feature's own query logic, since RLS alone
  would permit it. The one genuinely new table this feature adds is `tenant_config_action_log` (see
  Clarifications), append-only and platform-level with no RLS — mirroring `member_action_log`'s own
  posture and its `tm_app` INSERT/SELECT-only grant treatment (migration 0058).
- **Tenant-configurable vs. fixed platform-wide**: Every entity this feature touches (member role/
  department/custom-field-values, tenant roles+permissions, departments, tenant-scoped custom field
  definitions) is already tenant-configurable data under Principles II/III — this feature gives a
  Super Admin the same configuration access a tenant admin already has, it does not introduce a new
  configurable entity. Two things stay intentionally fixed and unreachable here: the single
  platform-wide Super Admin role (`tenant_id IS NULL`), and Spec 010's global (`tenant_id IS NULL`)
  custom field catalog — both remain platform-wide by design.
- **AI-generation review/approval step**: N/A — no AI-generated content is involved.
- **Kirkpatrick L4/L5 data source & formula**: N/A — this feature does not touch Results/ROI data.
- **Downgrade/cancellation behavior**: Directly implicated and resolved — per FR-012, all four write
  surfaces work identically regardless of a tenant's status; status changes themselves (Spec 015) do
  not gate this feature.
- **Design system reference**: This feature MUST reuse the established, locked design system and the
  existing Modal/form component patterns already used in the console (Specs 020/021) and in each of
  the four tenant-side edit forms being mirrored (Specs 009/010/011/013) — no new visual language is
  introduced.
- **Demoable vs. internal**: Demoable — a Super Admin can show a stakeholder "here's how I configure
  any tenant's roles, departments, forms, and member records to match what they need, without needing
  that tenant's own admin available."

## Assumptions

- This feature reuses the exact validation order, business rules, and error cases of each of the four
  existing tenant-side write mechanisms (Specs 009, 010, 011, 013) — no new business logic is
  introduced anywhere; only the caller (Super Admin session vs. tenant session) and the explicit
  tenant-scoping of every lookup change.
- Per Constitution Principle VIII (Comprehensive-Version Rule), member custom field values (Spec 013
  User Story 3) ARE included in this feature's member-edit surface, even though Specs 020/021
  deliberately excluded custom field values from the console's Members tab at the time — this spec's
  explicit goal (per its own Input) is full parity with what a tenant admin can already do, and that
  goal supersedes 020/021's narrower original scope. This is a deliberate expansion, not an
  oversight.
- Reordering custom fields (`form_field_order_overrides`) stays out of scope, per this feature's own
  explicit exclusion — create/edit/archive only, no drag-to-reorder.
- Deleting a department stays out of scope, consistent with the tenant-side department mechanism
  itself, which supports create/edit/status-change only, never a hard delete.
- Spec 020's FR-015 (no impersonation/session-swap) is unaffected by this feature and stays fully in
  force.
- This feature depends on: Spec 020 (the console and `member_action_log` table/RLS policies this
  extends), Spec 021 (the tenant-scoped role/department-exists helpers this feature reuses rather
  than reimplements), and Specs 009/010/011/013 (the four existing tenant-side write mechanisms being
  mirrored, unchanged, for a Super Admin caller).
- No new top-level navigation destination is introduced; this stays a set of actions within the
  existing console's existing tabs/views (Members, Roles, Departments, Forms).
